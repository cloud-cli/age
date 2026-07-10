import { functions as FS } from "./functions/fs.mjs";
import { functions as Git } from "./functions/git.mjs";
import { convertFunctionsToTools } from "./functions/tools.mjs";
import { readFile } from "node:fs/promises";

const API_KEY = process.env.OPENAI_API_KEY;
const modelApi = process.env.OPENAI_API_URL;
const model = process.env.MODEL;
const agentSystemPrompt = await readFile(
  new URL("./system.txt", import.meta.url),
  "utf8",
);

export const tools = [
  ...convertFunctionsToTools(FS),
  ...convertFunctionsToTools(Git),
];

const toolsByName = {
  ...FS,
  ...Git,
};

console.log(tools);

// call Ollama server to get a response from the model
// history is an array of messages, each message is an object with role and content, just like an OpenAI chat completion request
export async function getModelResponse(history) {
  const response = await fetch(new URL("/v1/chat", modelApi), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model,
      tools,
      messages: [
        {
          role: "system",
          content: agentSystemPrompt,
        },
        ...history,
      ],
    }),
  });

  return response.json();
}

function convertValue(value, type) {
  switch (type) {
    case "string":
      return String(value);
    case "number":
      return Number(value);
    case "boolean":
      return Boolean(value);
    case "object":
      return typeof value === "object" ? value : JSON.parse(value);

    default:
      return value;
  }
}

// name and args are coming from a model response, and we want to execute the corresponding function from the tools array
export function executeFunction(functionName, argsString) {
  const modelArgs = JSON.parse(argsString);
  const specs = tools.find((next) => next.function.name === functionName);

  if (!specs) {
    throw new Error(`Function not found: ${functionName}`);
  }

  // an array with [name, { type: x }]
  const args = Object.entries(specs.function.parameters.properties);
  const foundArgs = [];

  for (const [argName, x] of args) {
    const { type } = x;
    const value = modelArgs[argName];

    if (value === undefined) {
      continue;
    }

    foundArgs.push(convertValue(value, type));
  }

  return toolsByName[functionName](...foundArgs);
}
