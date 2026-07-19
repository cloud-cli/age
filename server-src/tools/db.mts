const baseURL = process.env.DATABASE_URL;

async function query(statement, data, method = "run") {
  const res = await fetch(new URL("/query", baseURL), {
    method: "POST",
    body: JSON.stringify({
      s: statement,
      d: data || null,
      m: method,
    }),
  });

  if (res.ok) {
    return await res.json();
  }

  throw new Error(await res.text());
}

function run(statement, data) {
  return query(statement, data, "run");
}

function all(statement, data) {
  return query(statement, data, "all");
}

export async function DatabaseQuery(/*string*/query, /*object*/data) {
    '##Runs a single prepared statement in the persistent SQL database. Query is prepared first, then data is inserted as fields.##';
    return await run(query, data);
}

export async function DatabaseSearch(/*string*/query, /*object*/data) {
    '##Find all matching rows for a single prepared statement in the persistent SQL database. Query is prepared first, then data is inserted as fields.##';
    return await all(query, data);
}