import { join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { tools, toolsByName } from "./tools.mjs";
import { callModel } from "./ollama-api.mjs";
import { publish } from "./events.mjs";
import { History } from "./history.mjs";

const defaultModel = process.env.MODEL;
const agentSystemPrompt = await readFile(new URL("./system.txt", import.meta.url), "utf8");

// call Ollama server to get a response from the model
// history is an array of messages, each message is an object with role and content, just like an OpenAI chat completion request
export async function getModelResponse(history, model) {
  const requestBody = {
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
  };

  const response = await callModel(requestBody);
  return response.message;
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
      return join(workspacePath, "files", resolve("/", s || "."));
    },
  };

  console.log(`Call ${functionName}`, modelArgs, foundArgs, workspacePath);
  return f.apply(context, foundArgs);
}

export async function runAgentLoop(options) {
  const { workspacePath, model = "", name, sessionId } = options;
  const history = new History(name, sessionId);
  let aiResponse;

  try {
    aiResponse = await getModelResponse(
      history.getMessagesForModel(),
      model || (await history.getModel()) || defaultModel,
    );

    if (aiResponse.error) {
      console.error(aiResponse);
      throw new Error("Invalid AI response");
    }

    if (model) {
      await history.setModel(model);
    }
  } catch (err) {
    console.error("Error getting model response", err);
    throw err;
  }

  async function addMessage(message) {
    await history.push(message);
    publish("message", { sessionId, message });
  }

  await addMessage(aiResponse);

  if (!aiResponse?.tool_calls?.length) {
    return;
  }

  for (const call of aiResponse.tool_calls) {
    const functionName = call.function.name;
    const functionArgs = call.function.arguments;

    try {
      const functionResponse = await executeFunction(functionName, functionArgs, workspacePath);

      await addMessage({
        role: "tool",
        tool_name: functionName,
        content: typeof functionResponse === "object" ? JSON.stringify(functionResponse) : String(functionResponse),
      });
    } catch (error) {
      console.error(`Error executing function: ${functionName} with args: ${JSON.stringify(functionArgs)}:\n ${error}`);
      await addMessage({
        role: "system",
        content: `Error executing function ${functionName} with args ${JSON.stringify(functionArgs)}:\nError: ${error}`,
      });
      return;
    }
  }

  return runAgentLoop(options);
}

export function addToQueue(job) {}
