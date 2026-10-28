import { readBoundedResponse } from "./http-body.mjs";

const baseURL = process.env.DATABASE_URL;
const maxStatementLength = 10_000;
const maxResponseBytes = 5 * 1024 * 1024;

async function query(statement: string, data: Record<string, unknown>, method: "run" | "all" = "run") {
  if (!statement.trim() || statement.length > maxStatementLength) {
    throw new Error(`SQL statement must contain 1-${maxStatementLength} characters`);
  }
  if (!baseURL) {
    throw new Error("DATABASE_URL is required");
  }
  const requestBody = JSON.stringify({ s: statement, d: data || null, m: method });
  if (Buffer.byteLength(requestBody, "utf8") > 1_000_000) {
    throw new Error("Database request exceeds the size limit");
  }
  const res = await fetch(new URL("query", new URL(".", baseURL)), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: requestBody,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Database query failed (${res.status})`);
  }
  const responseBody = await readBoundedResponse(res, maxResponseBytes);
  return JSON.parse(responseBody.toString("utf8"));
}

function run(statement: string, data: Record<string, unknown>) {
  return query(statement, data, "run");
}

function all(statement: string, data: Record<string, unknown>) {
  return query(statement, data, "all");
}

export async function DatabaseQuery(/*string*/ query: string, /*object*/ data: Record<string, unknown>) {
  "##Runs a single prepared statement in the persistent SQL database. Query is prepared first, then data is inserted as fields.##";
  return await run(query, data);
}

export async function DatabaseSearch(/*string*/ query: string, /*object*/ data: Record<string, unknown>) {
  "##Find all matching rows for a single prepared statement in the persistent SQL database. Query is prepared first, then data is inserted as fields.##";
  return await all(query, data);
}
