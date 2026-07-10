import createServer from "@cloud-cli/http";
import router from "micro-router";
import { readFileSync } from "node:fs";
import workspaces from "./src/workspaces.mjs";

const client = readFileSync("./client.mjs", "utf8");
const handler = router({ ...workspaces });

createServer((req, res) => {
  res.sendJson = (json, code = 200) => {
    const text = JSON.stringify(json, null, 2);
    res
      .writeHead(code, { "content-type": "application/json", "content-length": text.length, })
      .end(text);
  };

  if (!(req.method === "GET" && req.url === "/index.mjs")) {
    handler(req, res);
    return;
  }

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
});
