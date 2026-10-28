import * as FS from "./tools/fs.mjs";
import * as Git from "./tools/git.mjs";
import * as Shell from "./tools/shell.mjs";
import * as Deploy from "./tools/deploy.mjs";
import * as Ollama from "./tools/ollama.mjs";
import * as Markdown from "./tools/markdown.mjs";
import * as Database from "./tools/db.mjs";
import * as Core from "./tools/core.mjs";

type JsonSchemaType = "string" | "number" | "boolean" | "object";
type Parameter = { name: string; type: JsonSchemaType; optional: boolean };
type ToolFunction = Function;

function parseDescription(fnString: string) {
  return (
    fnString
      .split("\n")
      .find((line) => line.includes("##"))
      ?.trim()
      .replace(/^['"# ]+/g, "")
      .replace(/[#'"; ]+$/g, "") || ""
  );
}

function findParameterList(fnString: string) {
  const start = fnString.indexOf("(");
  if (start < 0) {
    return "";
  }
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = start; index < fnString.length; index += 1) {
    const character = fnString[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (["'", '"', "`"].includes(character)) {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        return fnString.slice(start + 1, index);
      }
    }
  }
  throw new Error("Could not parse tool function parameters");
}

function splitParameters(source: string) {
  const params: string[] = [];
  let start = 0;
  let parentheses = 0;
  let brackets = 0;
  let braces = 0;
  let quote = "";
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (["'", '"', "`"].includes(character)) {
      quote = character;
    } else if (character === "(") {
      parentheses += 1;
    } else if (character === ")") {
      parentheses -= 1;
    } else if (character === "[") {
      brackets += 1;
    } else if (character === "]") {
      brackets -= 1;
    } else if (character === "{") {
      braces += 1;
    } else if (character === "}") {
      braces -= 1;
    } else if (character === "," && parentheses === 0 && brackets === 0 && braces === 0) {
      params.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  const last = source.slice(start).trim();
  if (last) {
    params.push(last);
  }
  return params;
}

function inferParameterType(defaultValue: string): JsonSchemaType {
  const value = defaultValue.trim();
  if (/^(true|false)$/.test(value)) {
    return "boolean";
  }
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return "number";
  }
  if (/^(?:\{|\[)/.test(value)) {
    return "object";
  }
  return "string";
}

function parseParameters(fnString: string): Parameter[] {
  return splitParameters(findParameterList(fnString))
    .filter((parameter) => !parameter.startsWith("this:"))
    .map((parameter) => {
      const commentType = parameter.match(/\/\*\s*(string|number|boolean|object)\s*\*\//)?.[1] as
        JsonSchemaType | undefined;
      const withoutComment = parameter.replace(/\/\*.*?\*\//g, "").trim();
      const nameMatch = withoutComment.match(/^([A-Za-z_$][\w$]*)(?:\?)?/);
      if (!nameMatch) {
        throw new Error(`Could not parse tool parameter: ${parameter}`);
      }
      const name = nameMatch[1];
      const optional = /\s*=/.test(withoutComment) || /\?$/.test(nameMatch[0]);
      const defaultValue = withoutComment.split(/\s*=\s*/, 2)[1] || "";
      return { name, type: commentType || inferParameterType(defaultValue), optional };
    });
}

export const convertFunctionsToTools = (functions: Record<string, ToolFunction>) =>
  Object.entries(functions).map(([name, fn]) => {
    const source = fn.toString();
    const parameters = parseParameters(source);
    const properties: Record<string, { type: JsonSchemaType }> = {};
    for (const parameter of parameters) {
      properties[parameter.name] = { type: parameter.type };
    }

    return {
      type: "function" as const,
      function: {
        name,
        description: parseDescription(source),
        parameters: {
          type: "object" as const,
          properties,
          required: parameters.filter((parameter) => !parameter.optional).map((parameter) => parameter.name),
          additionalProperties: false,
        },
      },
    };
  });

const modules = [FS, Git, Shell, Deploy, Ollama, Markdown, Database, Core];
export const toolsByName = Object.assign({}, ...modules) as Record<string, ToolFunction>;
export const tools = convertFunctionsToTools(toolsByName);
