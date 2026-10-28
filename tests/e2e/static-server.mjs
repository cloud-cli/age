import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

const root = process.cwd();
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

createServer(async (request, response) => {
  const pathname = new URL(request.url || "/", "http://localhost").pathname;
  if (pathname === "/.env") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" }).end("{}");
    return;
  }
  const file = pathname === "/" ? "public/index.html" : pathname.replace(/^\//, "");
  const path = resolve(root, file);
  if (!path.startsWith(`${root}/`)) {
    response.writeHead(403).end();
    return;
  }
  try {
    let content = await readFile(path);
    if (pathname === "/public/api.mjs" || pathname === "/index.mjs") {
      content = content.toString("utf8").replaceAll("__BASE_URL__", request.headers.host);
    }
    response.writeHead(200, { "content-type": types[extname(path)] || "application/octet-stream" });
    response.end(content);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(4174, "127.0.0.1");
