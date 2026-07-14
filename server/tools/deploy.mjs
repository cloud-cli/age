import { execSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";

const deployUrl = new URL(process.env.DEPLOY_API_URL || "http://a");
const deployKey = process.env.DEPLOY_API_KEY;

export async function DeployPush(/*string*/ name, /*string*/ path = ".") {
  "##Deploy a folder at 'path' as a static page in AppHorde deploy server. If not specified, deploy the entire workspace.##";
  const workspaceDir = this.getPath(path);
  const sourceFilePath = "/tmp/" + randomUUID() + ".tgz";
  try {
    execSync(`tar cz -f ${sourceFilePath} .`, { cwd: workspaceDir });
    const source = readFileSync(sourceFilePath);
    const blob = new Blob([source], { type: "application/gzip" });
    const res = await fetch(deployUrl, {
      method: "POST",
      body: blob,
      headers: {
        authorization: deployKey,
        "content-type": "application/gzip",
        "x-deploy-alias": name,
      },
    });
    return await res.json();
  } catch (e) {
    throw e;
  } finally {
    existsSync(sourceFilePath) && rmSync(sourceFilePath);
  }
}

export async function DeployPull(/*string*/ name, /*string*/ targetPath = ".") {
  "##Pull an entire AppHorde static page into a folder##";
  const res = await fetch(new URL(name, deployUrl), {
    method: "COPY",
    headers: {
      Authorization: deployKey,
    },
  });

  const workspaceDir = this.getPath(targetPath);
  const buffer = Buffer.from(await res.arrayBuffer());
  const target = spawn("tar", ["-xz", "-f", "-", "--keep-newer-files"], {
    cwd: workspaceDir,
  });

  target.stdin.write(buffer);
  target.stdin.end();

  return new Promise((resolve) => {
    const chunks = [];
    target.stdout.on("data", (c) => chunks.push(c));
    target.stdout.on("close", () => {});

    resolve(Buffer.concat(chunks).toString("utf8"));
  });
}
