import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { mkdir as mkdirAsync } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import type { Context } from "../agents.mjs";
import { readBoundedResponse } from "./http-body.mjs";

const deployUrl = new URL(process.env.DEPLOY_API_URL || "http://a");
const deployKey = process.env.DEPLOY_API_KEY;
const maxArchiveBytes = 100 * 1024 * 1024;
const maxExtractedBytes = 250 * 1024 * 1024;
const maxArchiveEntries = 10_000;
type WorkspaceContext = Pick<Context, "getPath">;

function requireDeployKey() {
  if (deployUrl.protocol !== "https:" || deployUrl.username || deployUrl.password) {
    throw new Error("DEPLOY_API_URL must be a credential-free HTTPS URL");
  }
  if (!deployKey) {
    throw new Error("DEPLOY_API_KEY is required");
  }
  return deployKey;
}

function validateAlias(name: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) || name === "." || name === "..") {
    throw new Error("Deployment name must be a simple alias");
  }
}

function tarField(header: Buffer, offset: number, length: number) {
  const field = header.subarray(offset, offset + length);
  const zero = field.indexOf(0);
  return field.subarray(0, zero < 0 ? field.length : zero).toString("utf8");
}

function tarOctal(header: Buffer, offset: number, length: number) {
  const field = tarField(header, offset, length).trim();
  if (!/^[0-7]*$/.test(field)) {
    throw new Error("Unsupported tar archive size encoding");
  }
  return field ? Number.parseInt(field, 8) : 0;
}

function validateTarHeader(header: Buffer) {
  const expected = tarOctal(header, 148, 8);
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index];
  }
  if (actual !== expected) {
    throw new Error("Deployment archive contains a malformed tar header");
  }
}

function parsePaxRecords(data: Buffer) {
  const records = new Map<string, string>();
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space < 0) {
      throw new Error("Deployment archive contains malformed PAX metadata");
    }
    const lengthText = data.subarray(offset, space).toString("ascii");
    if (!/^\d+$/.test(lengthText)) {
      throw new Error("Deployment archive contains malformed PAX metadata");
    }
    const recordLength = Number(lengthText);
    const end = offset + recordLength;
    if (
      !Number.isSafeInteger(recordLength) ||
      recordLength <= space - offset + 2 ||
      end > data.length ||
      data[end - 1] !== 0x0a
    ) {
      throw new Error("Deployment archive contains malformed PAX metadata");
    }
    const record = data.subarray(space + 1, end - 1).toString("utf8");
    const separator = record.indexOf("=");
    if (separator <= 0) {
      throw new Error("Deployment archive contains malformed PAX metadata");
    }
    const key = record.slice(0, separator);
    const value = record.slice(separator + 1);
    if (!/^(?:path|size|mtime|atime|ctime|uid|gid|uname|gname|comment|charset|hdrcharset)$/.test(key)) {
      throw new Error("Deployment archive uses unsupported PAX metadata");
    }
    records.set(key, value);
    offset = end;
  }
  return records;
}

async function validateTarArchive(archive: Buffer) {
  const gunzip = Readable.from([archive]).pipe(createGunzip());
  let pending = Buffer.alloc(0);
  let entryBytesRemaining = 0;
  let totalExpandedBytes = 0;
  let totalFileBytes = 0;
  let entryCount = 0;
  let ended = false;
  const paths = new Set<string>();
  let currentMetadata: "local" | "global" | undefined;
  let metadataRemaining = 0;
  let metadataChunks: Buffer[] = [];
  let pendingPaxPath: string | undefined;
  let pendingPaxSize: number | undefined;

  for await (const part of gunzip) {
    totalExpandedBytes += part.length;
    if (totalExpandedBytes > maxExtractedBytes + maxArchiveEntries * 512) {
      throw new Error("Deployment archive expands beyond the extraction limit");
    }
    if (ended) {
      continue;
    }
    pending = Buffer.concat([pending, part]);
    while (true) {
      if (entryBytesRemaining) {
        const consumed = Math.min(entryBytesRemaining, pending.length);
        if (currentMetadata && metadataRemaining > 0) {
          const metadataBytes = Math.min(metadataRemaining, consumed);
          metadataChunks.push(pending.subarray(0, metadataBytes));
          metadataRemaining -= metadataBytes;
        }
        pending = pending.subarray(consumed);
        entryBytesRemaining -= consumed;
        if (entryBytesRemaining) {
          break;
        }
      }
      if (currentMetadata) {
        const records = parsePaxRecords(Buffer.concat(metadataChunks));
        if (currentMetadata === "global") {
          if (records.has("path") || records.has("size")) {
            throw new Error("Global PAX path and size overrides are not supported");
          }
        } else {
          if (records.has("path")) {
            pendingPaxPath = records.get("path");
          }
          if (records.has("size")) {
            const sizeText = records.get("size")!;
            if (!/^\d+$/.test(sizeText)) {
              throw new Error("Deployment archive contains an invalid PAX size");
            }
            pendingPaxSize = Number(sizeText);
            if (!Number.isSafeInteger(pendingPaxSize) || pendingPaxSize > maxExtractedBytes) {
              throw new Error("Deployment archive expands beyond the extraction limit");
            }
          }
        }
        currentMetadata = undefined;
        metadataChunks = [];
        metadataRemaining = 0;
      }
      if (pending.length < 512) {
        break;
      }
      const header = pending.subarray(0, 512);
      pending = pending.subarray(512);
      if (header.every((byte) => byte === 0)) {
        ended = true;
        break;
      }
      validateTarHeader(header);

      const rawName = tarField(header, 0, 100);
      const prefix = tarField(header, 345, 155);
      const headerPath = prefix ? `${prefix}/${rawName}` : rawName;
      const type = header[156] === 0 ? "0" : String.fromCharCode(header[156]);
      if (type === "x" || type === "g") {
        const size = tarOctal(header, 124, 12);
        if (size > 1_000_000) {
          throw new Error("PAX metadata exceeds the size limit");
        }
        entryCount += 1;
        if (entryCount > maxArchiveEntries) {
          throw new Error("Deployment archive contains too many entries");
        }
        currentMetadata = type === "x" ? "local" : "global";
        metadataRemaining = size;
        metadataChunks = [];
        entryBytesRemaining = Math.ceil(size / 512) * 512;
        continue;
      }

      const archivePath = pendingPaxPath ?? headerPath;
      pendingPaxPath = undefined;
      const normalizedPath = archivePath.replace(/\/+$/, "");
      if (!["0", "5"].includes(type)) {
        throw new Error("Deployment archives may contain only regular files and directories");
      }
      if (
        !normalizedPath ||
        normalizedPath.includes("\0") ||
        normalizedPath.length > 4096 ||
        normalizedPath.startsWith("/") ||
        normalizedPath.startsWith("\\") ||
        /^[A-Za-z]:/.test(normalizedPath) ||
        normalizedPath.split(/[\\/]/).some((segment) => segment === "..") ||
        normalizedPath.split(/[\\/]/).some((segment) => Buffer.byteLength(segment, "utf8") > 255)
      ) {
        if (normalizedPath !== ".") {
          throw new Error("Deployment archive contains an unsafe path");
        }
      }
      if (normalizedPath !== ".") {
        paths.add(normalizedPath);
      }

      entryCount += 1;
      if (entryCount > maxArchiveEntries) {
        throw new Error("Deployment archive contains too many entries");
      }
      const size = pendingPaxSize ?? tarOctal(header, 124, 12);
      pendingPaxSize = undefined;
      totalFileBytes += size;
      if (totalFileBytes > maxExtractedBytes) {
        throw new Error("Deployment archive expands beyond the extraction limit");
      }
      entryBytesRemaining = Math.ceil(size / 512) * 512;
    }
  }

  if (entryBytesRemaining || !ended) {
    throw new Error("Deployment archive is incomplete or malformed");
  }
  return [...paths];
}

export async function DeployPush(this: WorkspaceContext, /*string*/ name: string, /*string*/ path = ".") {
  "##Deploy a folder at 'path' as a static page in AppHorde deploy server. If not specified, deploy the entire workspace.##";
  validateAlias(name);
  const authorization = requireDeployKey();
  const workspaceDir = this.getPath(path);
  const sourceFilePath = join("/tmp", `${randomUUID()}.tgz`);
  try {
    execFileSync("tar", ["czf", sourceFilePath, "--exclude=.git", "--exclude=node_modules", "."], {
      cwd: workspaceDir,
      timeout: 30_000,
      maxBuffer: 100_000,
    });
    if (statSync(sourceFilePath).size > maxArchiveBytes) {
      throw new Error("Deployment archive exceeds the size limit");
    }
    const source = readFileSync(sourceFilePath);
    await validateTarArchive(source);
    const blob = new Blob([source], { type: "application/gzip" });
    const res = await fetch(deployUrl, {
      method: "POST",
      body: blob,
      headers: {
        authorization,
        "content-type": "application/gzip",
        "x-deploy-alias": name,
      },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`Deployment request failed (${res.status})`);
    }
    const response = await readBoundedResponse(res, 1_000_000);
    return JSON.parse(response.toString("utf8"));
  } finally {
    if (existsSync(sourceFilePath)) {
      rmSync(sourceFilePath);
    }
  }
}

export async function DeployPull(this: WorkspaceContext, /*string*/ name: string, /*string*/ targetPath = ".") {
  "##Pull an entire AppHorde static page into a folder##";
  validateAlias(name);
  const authorization = requireDeployKey();
  const url = new URL(name, deployUrl);
  if (url.origin !== deployUrl.origin || url.username || url.password) {
    throw new Error("Deployment URL must stay on the configured deploy server");
  }
  const res = await fetch(url, {
    method: "COPY",
    headers: { Authorization: authorization },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`Deployment download failed (${res.status})`);
  }

  const workspaceDir = this.getPath(targetPath);
  const buffer = await readBoundedResponse(res, maxArchiveBytes);
  const archivePaths = await validateTarArchive(buffer);
  for (const path of archivePaths) {
    this.getPath(join(targetPath, path));
  }
  await mkdirAsync(workspaceDir, { recursive: true });
  const target = spawn("tar", ["-xz", "-f", "-", "--keep-newer-files", "--no-same-owner", "--no-same-permissions"], {
    cwd: workspaceDir,
    stdio: ["pipe", "ignore", "pipe"],
  });

  return new Promise<string>((resolve, reject) => {
    const errors: Buffer[] = [];
    let errorSize = 0;
    let settled = false;
    const timer = setTimeout(() => target.kill("SIGKILL"), 30_000);
    const finish = (callback: () => void) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        callback();
      }
    };

    target.stderr.on("data", (chunk: Buffer) => {
      if (errorSize < 8_000) {
        const bounded = chunk.subarray(0, 8_000 - errorSize);
        errors.push(bounded);
        errorSize += bounded.length;
      }
    });
    target.once("error", (error) => finish(() => reject(error)));
    target.once("close", (code, signal) => {
      if (code === 0) {
        finish(() => resolve(`Deployment ${name} pulled successfully`));
      } else {
        const detail = Buffer.concat(errors).toString("utf8").trim();
        finish(() => reject(new Error(`tar extraction failed (${signal ?? code})${detail ? `: ${detail}` : ""}`)));
      }
    });
    target.stdin.once("error", (error) => finish(() => reject(error)));
    target.stdin.end(buffer);
  });
}
