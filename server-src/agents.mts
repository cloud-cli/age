import { join, resolve, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { tools, toolsByName } from "./tools.mjs";
import { callModel } from "./backend/ollama.mjs";
import { History } from "./history.mjs";
import { dataDir } from "./env.mjs";
import { publish } from "./events.mjs";

const defaultModel = process.env.MODEL;
const agentSystemPrompt = await readFile(new URL("./../system.txt", import.meta.url), "utf8");

export class Context {
  workspace: string;
  sessionId: string;

  constructor(p: Partial<Context>) {
    Object.assign(this, p);
  }

  get uid() {
    return `${this.workspace}__${this.sessionId}`;
  }

  get workspacePath() {
    return join(dataDir, this.workspace);
  }

  getPath(s) {
    const root = resolve(this.workspacePath, "files");
    const realRoot = realpathSync(root);
    const input = String(s || ".").replace(/^[/\\]+/, "");
    const target = resolve(root, input);
    const rel = relative(root, target);
    if (rel === ".." || rel.startsWith(`..${sep}`) || resolve(target) !== target) {
      throw new Error("Path escapes workspace");
    }
    // Resolve the nearest existing target so symlinks cannot escape the workspace.
    let existing = target;
    while (!existsSync(existing)) {
      existing = resolve(existing, "..");
    }
    const realExisting = realpathSync(existing);
    if (realExisting !== realRoot && !realExisting.startsWith(realRoot + sep)) {
      throw new Error("Path escapes workspace");
    }
    return target;
  }
}

export async function getModelResponse(history: History, subject?: string) {
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

  const m = await callModel(requestBody, subject);
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

export async function executeFunction(functionName: string, modelArgs: any[], context: Context) {
  const specs = tools.find((next) => next.function.name === functionName);

  if (!specs) {
    throw new Error(`Function not found: ${functionName}`);
  }

  if (!modelArgs || typeof modelArgs !== "object" || Array.isArray(modelArgs)) {
    throw new Error("Tool arguments must be an object");
  }
  const args: [string, any][] = Object.entries(specs.function.parameters.properties);
  const foundArgs: any[] = [];

  for (const [argName, x] of args) {
    const { type } = x;
    const value = modelArgs[argName];

    if (value === undefined) {
      foundArgs.push(undefined);
      continue;
    }

    if (type === "string" && typeof value !== "string") {
      throw new Error(`Invalid argument: ${argName} must be a string`);
    }
    if (type === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
      throw new Error(`Invalid argument: ${argName} must be a number`);
    }
    if (type === "boolean" && typeof value !== "boolean") {
      throw new Error(`Invalid argument: ${argName} must be a boolean`);
    }
    if (type === "object" && (typeof value !== "object" || value === null || Array.isArray(value))) {
      throw new Error(`Invalid argument: ${argName} must be an object`);
    }
    foundArgs.push(convertValue(value, type));
  }

  const f = toolsByName[functionName];

  console.log(`Call ${functionName}`, foundArgs);
  const required = specs.function.parameters.required || [];
  if (required.some((name) => modelArgs[name] === undefined)) {
    throw new Error("Missing required tool arguments");
  }
  const readOnly = [
    "ReadFile",
    "Glob",
    "Grep",
    "WebFetch",
    "WebSearch",
    "GetFileStats",
    "ListFiles",
    "ReadProject",
    "ReadTasks",
  ];
  const safeTool = readOnly.includes(functionName);
  if (!safeTool && process.env.ALLOW_MUTATING_TOOLS !== "true") {
    return { status: "approval_required", tool: functionName };
  }
  return await f.apply(context, foundArgs);
}

export async function runAgentLoop(workspace, sessionId, depth = 0, subject?: string) {
  if (depth >= Number(process.env.AGENT_MAX_TOOL_ROUNDS || 12)) {
    return;
  }
  const history = new History(workspace, sessionId);
  let aiResponse;

  try {
    aiResponse = await getModelResponse(history, subject);

    if (aiResponse.error) {
      console.error("aiResp", aiResponse);
      throw new Error("Invalid AI response");
    }
  } catch (err) {
    console.error("Error getting model response", err.toString("utf8"));
    throw err;
  }

  async function addMessage(message) {
    message.meta = { uid: randomUUID() };
    await history.push(message);
    publish("message", { sessionId, message });
  }

  await addMessage(aiResponse);

  if (!aiResponse?.tool_calls?.length) {
    return;
  }

  for (const call of aiResponse.tool_calls) {
    const functionName = call.function.name;
    let functionArgs;

    try {
      functionArgs =
        typeof call.function.arguments === "string" ? JSON.parse(call.function.arguments) : call.function.arguments;
      const context = new Context({ sessionId, workspace });
      const functionResponse = await executeFunction(functionName, functionArgs, context);

      await addMessage({
        role: "tool",
        tool_name: functionName,
        content: typeof functionResponse === "object" ? JSON.stringify(functionResponse) : String(functionResponse),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Error executing function: ${functionName} with args: ${JSON.stringify(functionArgs)}:\n ${error}`);
      await addMessage({
        role: "system",
        content: `Error executing function ${functionName} with args ${JSON.stringify(functionArgs)}:\nError: ${errorMessage}`,
      });
      break;
    }
  }

  return runAgentLoop(workspace, sessionId, depth + 1, subject);
}

async function main() {
  const [workspace, sessionId] = process.argv.slice(2);

  try {
    await runAgentLoop(workspace, sessionId);
    return process.exit(0);
  } catch {
    process.exit(1);
  }
}

if (process.env.AGENT_WORKERS) {
  main();
}
