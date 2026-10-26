import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "./env.mjs";
import { migrateConnectors } from "./connectors.mjs";

type Membership = { teamId: string; role: "owner" | "admin" | "member" };
type Team = { id: string; name: string; members: Record<string, Membership["role"]> };
type State = { teams: Record<string, Team>; users: Record<string, string> };
const file = join(dataDir, "teams.json");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
let queue = Promise.resolve();

async function state(): Promise<State> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { teams: {}, users: {} };
    }
    throw error;
  }
}

async function update<T>(fn: any): Promise<T> {
  const result = queue.then(async () => {
    const data = await state();
    const value = fn(data);
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(data), { mode: 0o600 });
    await rename(temp, file);
    return value;
  });
  queue = result.then(
    () => {},
    () => {},
  );
  return result;
}

export async function teamFor(subject: string) {
  return (await state()).users[hash(subject)];
}

export async function readTeam(subject: string) {
  const data = await state();
  const teamId = data.users[hash(subject)];
  const team = teamId && data.teams[teamId];
  if (!team) {
    return null;
  }
  return {
    id: team.id,
    name: team.name,
    role: team.members[subject],
    members: Object.entries(team.members).map(([sub, role]) => ({ sub, role })),
  };
}

export async function createTeam(subject: string, name: string) {
  const team = await update<{ id: string; name: string; role: string; members: Array<{ sub: string; role: string }> }>(
    (data: State) => {
      const user = hash(subject);
      if (data.users[user]) {
        throw new Error("Already belongs to a team");
      }
      const id = randomUUID();
      const team: Team = {
        id,
        name: name.trim().slice(0, 100) || "My team",
        members: { [subject]: "owner" },
      };
      data.teams[id] = team;
      data.users[user] = id;
      return { id, name: team.name, role: "owner", members: [{ sub: subject, role: "owner" }] };
    },
  );
  await migrateConnectors(subject, team.id);
  return team;
}

export async function addTeamMember(subject: string, memberSubject: string) {
  if (typeof memberSubject !== "string" || memberSubject.trim().length < 1 || memberSubject.length > 512) {
    throw new Error("Enter a valid OIDC subject");
  }
  const invitedSubject = memberSubject.trim();
  const team = await update<{ id: string; name: string; role: string }>((data: State) => {
    const user = hash(subject);
    const team = data.teams[data.users[user]];
    if (!team || !["owner", "admin"].includes(team.members[subject])) {
      throw new Error("Team admin required");
    }
    if (data.users[hash(invitedSubject)]) {
      throw new Error("This person already belongs to a team");
    }
    team.members[invitedSubject] = "member";
    data.users[hash(invitedSubject)] = team.id;
    return { id: team.id, name: team.name, role: "member" };
  });
  return team;
}
