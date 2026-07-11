import createServer from "@cloud-cli/http";
import router from "micro-router";
import { readFileSync } from "node:fs";
import workspaces from "./src/workspaces.mjs";

const client = readFileSync("./public/index.mjs", "utf8");
const indexPage = readFileSync("./public/index.html", "utf8");
const manifest = readFileSync("./public/manifest.json", "utf8");
const icon = readFileSync("./public/icon.svg", "utf8");
const handler = router(workspaces);

createServer((req, res) => {
  const url = new URL(req.url, "http://a");
  const route = `${req.method} ${url.pathname}`;

  if (route === "GET /favicon.ico") {
    res.writeHead(404).end();
    return;
  }

  if (route === "GET /icon.svg") {
    res.writeHead(200, { "content-type": "image/svg" }).end(icon);
    return;
  }

  if (route === "GET /") {
    res.end(indexPage);
    return;
  }

  if (route === "GET /index.mjs") {
    const code = client.replace(
      "__BASE_URL__",
      String(req.headers["x-forwarded-for"]),
    );

    res
      .writeHead(200, {
        "Content-Type": "text/javascript",
        "Content-Length": code.length,
        "Cache-Control": "max-age=604800, must-revalidate",
        "Access-Control-Allow-Origin": "*",
      })
      .end(code);
    return;
  }

  if (route === "GET /manifest.json") {
    res
      .writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "max-age=604800, must-revalidate",
        "Access-Control-Allow-Origin": "*",
      })
      .end(manifest);
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

  handler(req, res);
});
