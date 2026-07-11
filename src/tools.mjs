import { convertFunctionsToTools } from "./functions/tools.mjs";
import * as FS from "./functions/fs.mjs";
import * as Git from "./functions/git.mjs";
import * as Shell from "./functions/shell.mjs";
import * as Deploy from "./functions/deploy.mjs";
import * as Ollama from "./functions/ollama.mjs";

export const tools = [];
export const toolsByName = {};

for (const t of [FS, Git, Shell, Deploy, Ollama]) {
  tools.push(...convertFunctionsToTools(t));
  Object.assign(toolsByName, t);
}
