import { createServer } from "node:http";
import router from "micro-router";
import { readFileSync, existsSync, statSync, createReadStream } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve, parse, join } from "node:path";
import * as oidc from "openid-client";
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

const env = JSON.stringify({
  MESSAGE_HUB_URL: process.env.APP_MESSAGE_HUB_URL || "",
});

const requiredOidcEnv = ["OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_REDIRECT_URI", "APP_ORIGIN"];
const sessions = new Map();
const pendingLogins = new Map();
const SESSION_MAX = 1000;
const SESSION_TTL = 8 * 60 * 60 * 1000;
const COOKIE = "age_session";
const LOGIN_COOKIE = "age_login";
const randomId = () => randomBytes(32).toString("base64url");
const cookieValue = (header, name) =>
  String(header || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
const setCookie = (res, name, value, maxAge) =>
  res.setHeader("Set-Cookie", `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
const setSessionCookie = (res, value, maxAge) => setCookie(res, COOKIE, value, maxAge);
const validOrigin = (req) => req.headers.origin === process.env.APP_ORIGIN;

const server = createServer(async (req, res) => {
  res.on("finish", () => {
    console.log(`[${new Date().toISOString().slice(0, 19)}] [${res.statusCode}] ${req.method} ${req.url}`);
  });

  const url = new URL(req.url, "http://a");
  const route = `${req.method} ${url.pathname}`;

  if (route === "GET /auth/login") {
    const state = randomId();
    const nonce = oidc.randomNonce();
    const verifier = oidc.randomPKCECodeVerifier();
    const challenge = await oidc.calculatePKCECodeChallenge(verifier);
    const binding = randomId();
    for (const [key, login] of pendingLogins) {
      if (login.expires <= Date.now()) pendingLogins.delete(key);
    }
    while (pendingLogins.size >= SESSION_MAX) pendingLogins.delete(pendingLogins.keys().next().value);
    pendingLogins.set(state, { binding, nonce, verifier, expires: Date.now() + 10 * 60 * 1000 });
    setCookie(res, LOGIN_COOKIE, binding, 10 * 60);
    const target = oidc.buildAuthorizationUrl(oidcConfig, {
      redirect_uri: process.env.OIDC_REDIRECT_URI,
      response_type: "code",
      scope: "openid profile email",
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    res.writeHead(302, { Location: target.href }).end();
    return;
  }

  if (route === "GET /auth/callback") {
    const state = url.searchParams.get("state");
    const pending = pendingLogins.get(state);
    pendingLogins.delete(state);
    if (!pending || pending.binding !== cookieValue(req.headers.cookie, LOGIN_COOKIE) || pending.expires < Date.now()) {
      res.writeHead(400).end("Invalid login state");
      return;
    }
    try {
      const callbackUrl = new URL(process.env.OIDC_REDIRECT_URI);
      url.searchParams.forEach((value, key) => callbackUrl.searchParams.set(key, value));
      const tokens = await oidc.authorizationCodeGrant(oidcConfig, callbackUrl, {
        expectedState: state,
        expectedNonce: pending.nonce,
        pkceCodeVerifier: pending.verifier,
      });
      const claims = tokens.claims();
      const sid = randomId();
      sessions.set(sid, {
        claims: { sub: claims.sub, name: claims.name, email: claims.email },
        expires: Date.now() + SESSION_TTL,
      });
      while (sessions.size > SESSION_MAX) sessions.delete(sessions.keys().next().value);
      res.setHeader("Set-Cookie", [
        `${LOGIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
        `${COOKIE}=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`,
      ]);
      res.writeHead(302, { Location: "/" }).end();
    } catch (error) {
      console.error("OIDC callback failed", error.message);
      res.writeHead(401).end("Login failed");
    }
    return;
  }

  if (route === "POST /auth/logout") {
    if (!validOrigin(req)) {
      res.writeHead(403).end("Invalid origin");
      return;
    }
    const sid = cookieValue(req.headers.cookie, COOKIE);
    if (sid) sessions.delete(sid);
    setSessionCookie(res, "", 0);
    res.writeHead(204).end();
    return;
  }

  if (route === "GET /api/me") {
    const session = sessions.get(cookieValue(req.headers.cookie, COOKIE));
    if (!session || session.expires <= Date.now()) {
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "Not authorized" }));
      return;
    }
    res
      .writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
      .end(JSON.stringify({ sub: session.claims.sub, name: session.claims.name, email: session.claims.email }));
    return;
  }

  if (route === "GET /.env") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(env);
    return;
  }

  if (route === "GET /favicon.ico") {
    res.writeHead(404).end();
    return;
  }

  if (route === "GET /") {
    res.end(indexPage);
    return;
  }

  if (route === "GET /index.mjs" || route === "GET /public/api.mjs") {
    const code = client.replace("__BASE_URL__", String(req.headers["x-forwarded-host"]));

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

    res.setHeader("Cache-Control", `max-age=${url.searchParams.has("nocache") ? 1 : 300}, must-revalidate`);

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

  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    if (!validOrigin(req)) {
      res.writeHead(403).end("Invalid origin");
      return;
    }
  }

  const sessionId = cookieValue(req.headers.cookie, COOKIE);
  const session = sessions.get(sessionId);
  if (!session || session.expires <= Date.now()) {
    res.sendJson({ error: "Not authorized" }, 401);
    return;
  }

  handler(req, res);
});

async function start() {
  const missing = requiredOidcEnv.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing required OIDC configuration: ${missing.join(", ")}`);
  const issuer = new URL(process.env.OIDC_ISSUER);
  oidcConfig = await oidc.discovery(
    issuer,
    process.env.OIDC_CLIENT_ID,
    { client_secret: process.env.OIDC_CLIENT_SECRET },
    oidc.ClientSecretPost(process.env.OIDC_CLIENT_SECRET),
  );
  server.listen(Number(process.env.PORT), () => console.log(`Server started on port ${process.env.PORT}`));
}

let oidcConfig;
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  start().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
