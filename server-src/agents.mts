import { join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { tools, toolsByName } from "./tools.mjs";
import { callModel } from "./backend/ollama.mjs";
import { History } from "./history.mjs";
import { randomUUID } from "node:crypto";
import { dataDir } from "./env.mjs";
import { publish } from "./events.mjs";

const defaultModel = process.env.MODEL;
const agentSystemPrompt = await readFile(new URL("./../system.txt", import.meta.url), "utf8");

export async function getModelResponse(history: History) {
  const requestBody = {
    model: (await history.getModel()) || defaultModel,
    tools,
    stream: false,
    think: true,
    messages: [
      {
        role: "system",
        content: agentSystemPrompt,
      },
      ...(await history.getMessagesForModel()),
    ],
  };

  const m = await callModel(requestBody);
  console.log('getModelResp', m);
  return m.message;
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

export function executeFunction(functionName, modelArgs, workspacePath) {
  const specs = tools.find((next) => next.function.name === functionName);

  if (!specs) {
    throw new Error(`Function not found: ${functionName}`);
  }

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

export async function runAgentLoop(workspace, sessionId) {
  const workspacePath = join(dataDir, workspace);
  const history = new History(workspace, sessionId);
  let aiResponse;

  try {
    aiResponse = await getModelResponse(history);

    if (aiResponse.error) {
      console.error('aiResp', aiResponse);
      throw new Error("Invalid AI response");
    }
  } catch (err) {
    console.error("Error getting model response", err.toString('utf8'));
    throw err;
  }

  async function addMessage(message) {
    message.meta = { uid: randomUUID() };
    await history.push(message);
    if (process.env.AGENT_WORKERS) {
      process.stdout.write(JSON.stringify({ type: "message", data: { sessionId, message } }) + "\n");
    } else {
      publish("message", { sessionId, message });
    }
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
      break;
    }
  }

  return runAgentLoop(workspace, sessionId);
}

async function main() {
  const [workspace, sessionId] = process.argv.slice(2);

  try {
    await runAgentLoop(workspace, sessionId);
    return process.exit(0);
  } catch (e) {
    console.log('main c', e);
    process.exit(1);
  }
}

if (process.env.AGENT_WORKERS) {
  main();
}
