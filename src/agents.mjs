import { join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { convertFunctionsToTools } from "./functions/tools.mjs";
import { functions as FS } from "./functions/fs.mjs";
import { functions as Git } from "./functions/git.mjs";
import { functions as Shell } from "./functions/shell.mjs";

const API_KEY = process.env.API_KEY;
const modelApi = process.env.API_URL;
const defaultModel = process.env.MODEL;
const agentSystemPrompt = await readFile(
  new URL("./system.txt", import.meta.url),
  "utf8",
);

export const tools = [
  ...convertFunctionsToTools(FS),
  ...convertFunctionsToTools(Git),
  ...convertFunctionsToTools(Shell),
];

const toolsByName = {
  ...FS,
  ...Git,
  ...Shell,
};

// call Ollama server to get a response from the model
// history is an array of messages, each message is an object with role and content, just like an OpenAI chat completion request
export async function getModelResponse(history, model = defaultModel) {
  const requestBody = JSON.stringify({
    model,
    tools,
    stream: false,
    think: true,
    messages: [
      {
        role: "system",
        content: agentSystemPrompt,
      },
      ...history,
    ],
  });

  const response = await fetch(new URL("/api/chat", modelApi), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
    },
    body: requestBody,
  });

  const body = await response.text();
  const json = JSON.parse(body);

  return json.message;
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
export function executeFunction(functionName, modelArgs, workspacePath) {
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

  const f = toolsByName[functionName];
  const context = {
    getPath(s) {
      const x = join(workspacePath, "files", resolve("/", s || "."));
      console.log("GetPath", s, x);
      return x;
    },
  };

  console.log(`Call ${functionName}`, modelArgs, foundArgs, workspacePath);
  return f.apply(context, foundArgs);
}

export async function runAgentLoop(history, workspacePath) {
  let aiResponse;

  try {
    aiResponse = await getModelResponse(history.messages, history.model);

    if (aiResponse.error) {
      throw new Error("Invalid AI response: " + aiResponse.error);
    }

    console.log("AI response", aiResponse);
  } catch (err) {
    console.error(
      `Error getting model response at ${historyFile}: ${err.message}`,
    );
    res.sendJson({ error: err.message }, 500);
    return;
  }

  history.messages.push(aiResponse);

  if (!aiResponse?.tool_calls?.length) {
    return;
  }

  for (const call of aiResponse.tool_calls) {
    const functionName = call.function.name;
    const functionArgs = call.function.arguments;

    try {
      const functionResponse = await executeFunction(
        functionName,
        functionArgs,
        workspacePath,
      );

      history.messages.push({
        role: "tool",
        tool_name: functionName,
        content:
          typeof functionResponse === "object"
            ? JSON.stringify(functionResponse)
            : String(functionResponse),
      });
    } catch (error) {
      console.error(
        `Error executing function: ${functionName} with args: ${JSON.stringify(functionArgs)}:\n ${error}`,
      );
      history.messages.push({
        role: "system",
        content: `Error executing function ${functionName} with args ${JSON.stringify(functionArgs)}:\nError: ${error}`,
      });
      return;
    }
  }

  return runAgentLoop(history, workspacePath);
}
