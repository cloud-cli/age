import createServer from "@cloud-cli/http";
import router from "micro-router";
import { readFileSync } from "node:fs";
import workspaces from "./workspaces.mjs";

const client = readFileSync("./client.mjs", "utf8");
const handler = router({ ...workspaces });

createServer((req, res) => {
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
