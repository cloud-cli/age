import * as FS from "./tools/fs.mjs";
import * as Git from "./tools/git.mjs";
import * as Shell from "./tools/shell.mjs";
import * as Deploy from "./tools/deploy.mjs";
import * as Ollama from "./tools/ollama.mjs";
import * as Markdown from "./tools/markdown.mjs";

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
    const params = match.split(",").map((param) => param.trim());

    return params
      .map((param) => {
        const [typeString, nameString] = param.includes("*/") ? param.split("*/") : ["/*string", param];

        if (!nameString) {
          return null;
        }

        const type = typeString.slice(2).trim();
        const name = (nameString.includes("=") ? nameString.split("=")[0] : nameString).trim();

        return { name, type };
      })
      .filter(Boolean);
  }

  return [];
}

// list of tools in a format used by AI function calls
export const convertFunctionsToTools = (functions) =>
  Object.entries(functions).map(([name, fn]) => {
    const properties = parseParameters(fn.toString()).reduce((acc, param) => {
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
        },
      },
    };
  });

export const tools: any[] = [];
export const toolsByName: Record<string, any> = {};

for (const t of [FS, Git, Shell, Deploy, Ollama, Markdown]) {
  tools.push(...convertFunctionsToTools(t));
  Object.assign(toolsByName, t);
}
