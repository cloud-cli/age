import { parseEnv } from 'node:util';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { tools, toolsByName } from './tools.mjs';
import { callModel } from './backend/ollama.mjs';
import { History } from './history.mjs';
import { dataDir } from './env.mjs';
import { publish } from './events.mjs';

const shell = process.env.SHELL || 'sh';
const defaultModel = process.env.MODEL;
const agentSystemPrompt = await readFile(new URL('./../system.txt', import.meta.url), 'utf8');

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

  getShell() {
    const tmpEnv = join(tmpdir(), this.uid + '.env');
    const env = { ...process.env, TMP_ENV: tmpEnv };

    if (existsSync(tmpEnv)) {
      Object.assign(env, parseEnv(readFileSync(tmpEnv, 'utf8')));
    }

    // const cwd = this.getPath('.');
    const sh = spawn(shell, [], {
      // cwd: env.PWD?.includes(cwd) ? env.PWD : cwd,
      shell,
      env,
    });

    function exec(v) {
      const chunks = [];
      sh.stdout.on('data', (c) => chunks.push(c));
      sh.stderr.on('data', (c) => chunks.push(c));

      return new Promise((resolve, reject) => {
        sh.stdin.write(v + '\n');
        sh.stdin.write('export shell_exit=$?\n');
        sh.stdin.write('env > $TMP_ENV\n');
        sh.stdin.write('exit $shell_exit\n');

        sh.on('exit', (code) => {
          const output = {
            code,
            output: Buffer.concat(chunks).toString('utf8')
          };

          code ? reject(output) : resolve(output);
        });
      });
    }

    return { exec };
  }

  getPath(s) {
    return join(this.workspacePath, 'files', resolve('/', s || '.'));
  }
}

export async function getModelResponse(history: History) {
  const requestBody = {
    model: (await history.getModel()) || defaultModel,
    tools,
    stream: false,
    think: true,
    messages: [
      {
        role: 'system',
        content: agentSystemPrompt,
      },
      ...(await history.getMessagesForModel()),
    ],
  };

  const m = await callModel(requestBody);
  return m.message;
}

function convertValue(value, type) {
  switch (type) {
    case 'string':
      return String(value);
    case 'number':
      return Number(value);
    case 'boolean':
      return Boolean(value);
    case 'object':
      return typeof value === 'object' ? value : JSON.parse(value);

    default:
      return value;
  }
}

export function executeFunction(functionName: string, modelArgs: any[], context: Context) {
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

  console.log(`Call ${functionName}`, foundArgs);
  return f.apply(context, foundArgs);
}

export async function runAgentLoop(workspace, sessionId) {
  const history = new History(workspace, sessionId);
  let aiResponse;

  try {
    aiResponse = await getModelResponse(history);

    if (aiResponse.error) {
      console.error('aiResp', aiResponse);
      throw new Error('Invalid AI response');
    }
  } catch (err) {
    console.error('Error getting model response', err.toString('utf8'));
    throw err;
  }

  async function addMessage(message) {
    message.meta = { uid: randomUUID() };
    await history.push(message);
    publish('message', { sessionId, message });
  }

  await addMessage(aiResponse);

  if (!aiResponse?.tool_calls?.length) {
    return;
  }

  for (const call of aiResponse.tool_calls) {
    const functionName = call.function.name;
    const functionArgs = call.function.arguments;

    try {
      const context = new Context({ sessionId, workspace });
      const functionResponse = await executeFunction(functionName, functionArgs, context);

      await addMessage({
        role: 'tool',
        tool_name: functionName,
        content: typeof functionResponse === 'object' ? JSON.stringify(functionResponse) : String(functionResponse),
      });
    } catch (error) {
      console.error(`Error executing function: ${functionName} with args: ${JSON.stringify(functionArgs)}:\n ${error}`);
      await addMessage({
        role: 'system',
        content: `Error executing function ${functionName} with args ${JSON.stringify(functionArgs)}:\nError: ${error.message}`,
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
    process.exit(1);
  }
}

if (process.env.AGENT_WORKERS) {
  main();
}
