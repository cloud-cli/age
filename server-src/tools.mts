import * as FS from "./tools/fs.mjs";
import * as Git from "./tools/git.mjs";
import * as Shell from "./tools/shell.mjs";
import * as Deploy from "./tools/deploy.mjs";
import * as Ollama from "./tools/ollama.mjs";
import * as Markdown from "./tools/markdown.mjs";
import * as Database from "./tools/db.mjs";
import * as Core from "./tools/core.mjs";

function parseDescription(fnString: string) {
  const lines = fnString.split("\n");
  return (
    lines
      .find((line) => line.includes("##"))
      ?.trim()
      .replace(/^['"# ]+/g, "")
      .replace(/[#'"; ]+$/g, "") || ""
  );
}

// parse the parameters from the function string representation and extract the type from an inline comment, e.g. /*string*/ paramName
// returns an array with { name: string, type: string, } objects
/**
 * @param {string} fnString A string representation of a function
 * @returns {Array<{ name: string, type: string }>} An array of parameter objects
 */
function parseParameters(fnString) {
  const start = fnString.indexOf("(") + 1;
  const end = fnString.indexOf(")", start);
  const match = fnString.slice(start, end).trim();

  if (match) {
    const params = match
      .split(",")
      .map((param) => param.trim())
      .filter((param) => !param.startsWith("this:"));

    return params
      .map((param) => {
        const [typeString, nameString] = param.includes("*/") ? param.split("*/") : ["/*string", param];

        if (!nameString) {
          return null;
        }

        const type = typeString.slice(2).trim();
        const name = (nameString.includes("=") ? nameString.split("=")[0] : nameString).trim();

        return { name, type, optional: nameString.includes("=") };
      })
      .filter(Boolean);
  }

  return [];
}

// list of tools in a format used by AI function calls
export const convertFunctionsToTools = (functions) =>
  Object.entries(functions as Record<string, Function>).map(([name, fn]) => {
    const parsedParameters = parseParameters(fn.toString());
    const properties = parsedParameters.reduce((acc, param) => {
      acc[param.name] = { type: param.type };
      return acc;
    }, {});

    return {
      type: "function",
      function: {
        name,
        description: parseDescription(fn.toString()),
        parameters: {
          type: "object",
          properties,
          required: parsedParameters.filter((param) => !param.optional).map((param) => param.name),
        },
      },
    };
  });

export const tools: any[] = [];
export const toolsByName: Record<string, any> = {};

for (const t of [FS, Git, Shell, Deploy, Ollama, Markdown, Database, Core]) {
  tools.push(...convertFunctionsToTools(t));
  for (const [name, fn] of Object.entries(t)) {
    if (name === "ReadFile" && toolsByName[name]) {
      tools.splice(
        tools.findIndex((tool) => tool.function.name === name),
        1,
      );
    }
    toolsByName[name] = fn;
  }
}
