import { createServer } from "node:http";
import router from "micro-router";
import { readFileSync, existsSync, statSync, createReadStream } from "node:fs";
import { resolve, parse, join } from "node:path";
import workspaces from "./server/workspaces.mjs";

const client = readFileSync("./public/api.mjs", "utf8");
const indexPage = readFileSync("./public/index.html", "utf8");
const handler = router(workspaces);
const mimeTypes = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
};

createServer((req, res) => {
  res.on('finish', () => { console.log(`[${new Date().toISOString().slice(0, 19)}] [${res.statusCode}] ${req.method} ${req.url}`); });

  const url = new URL(req.url, "http://a");
  const route = `${req.method} ${url.pathname}`;

  if (route === "GET /favicon.ico") {
    res.writeHead(404).end();
    return;
  }

  if (route === "GET /") {
    res.end(indexPage);
    return;
  }

  if (route === "GET /index.mjs" || route === "GET /public/api.mjs") {
    const code = client.replace("__BASE_URL__", String(req.headers["x-forwarded-for"]));

    res
      .writeHead(200, {
        "Content-Type": "text/javascript",
        "Content-Length": code.length,
        "Cache-Control": "max-age=3600, must-revalidate",
        "Access-Control-Allow-Origin": "*",
      })
      .end(code);
    return;
  }

  if (route.startsWith("GET /public/")) {
    const fullPath = join(process.cwd(), "public", resolve("/", url.pathname.replace("/public/", "")));

    res.setHeader("Cache-Control", `max-age=${url.searchParams.has("nocache") ? 1 : 86400}, must-revalidate`);

    if (existsSync(fullPath) && statSync(fullPath).isFile()) {
      const extension = parse(fullPath).ext.toLowerCase();
      res.setHeader("Content-Type", mimeTypes[extension] || "text/plain");
      createReadStream(fullPath).pipe(res);
    } else {
      console.log("404", fullPath);
      res.writeHead(404).end("Not found");
    }
    return;
  }

  res.sendJson = (json, code = 200) => {
    const text = JSON.stringify(json, null, 2);
    res.writeHead(code, {
      "content-type": "application/json",
    });
    res.write(text);
    res.end();
  };

  if (req.headers.authorization !== process.env.AUTH_KEY) {
    res.sendJson({ error: "Not authorized" }, 401);
    return;
  }

  handler(req, res);
});

server.listen(Number(process.env.PORT), () => {
  console.log(`Server started on port ${process.env.PORT}`);
});