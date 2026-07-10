import { createServer } from "@cloud-cli/http";
import router from "micro-router";
import { Resource, StoreDriver } from "@cloud-cli/store";
import { readFileSync } from "node:fs";
import workspaces from "./workspaces.mjs";

const port = Number(process.env.PORT || 0);
const client = readFileSync("./client.mjs", "utf8");

const api = router({
  ...workspaces,
});

createServer((req, res) => {
  if (!(req.method === "GET" && req.url === "/index.mjs")) {
    api.dispatch(req, res);
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
}).listen(port, () => {
  console.log(`Bot server running on port ${port}`);
  Resource.use(new StoreDriver());
  Resource.create(Bot);
});
