import { createServer } from "http";
import { Gateway, Resource as RestResource } from "@cloud-cli/gw";
import { Resource, StoreDriver } from "@cloud-cli/store";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const api = new Gateway();
const port = Number(process.env.PORT | 0);
const dataDir = process.env.DATA_PATH;
const client = readFileSync("./client.mjs", "utf8");

api.add(
  "workspaces",
  class extends RestResource {
    get body() {
      return { json: {} };
    }

    get(req, res) {
      const name = /^[^a-z0-9-]$/g.replace(
        req.url.split("/")[0].toLowerCase(),
        "",
      );

      const path = join(dataDir, name);

      if (!existsSync(path)) {
        res.writeHead(404).end("Not found");
        return;
      }

      res.end("OK");
    }
  },
);

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
