import { Workspaces } from "@app/api.mjs";
import { defineStore } from "@li3/store";
import { effect, hook, ref } from "@li3/web";

export const useWorkspaces = defineStore("workspaces", function () {
  const [workspace, setWorkspace] = hook("");
  const workspaceList = ref([]);
  const project = ref(null);
  const tasks = ref([]);

  async function reloadWorkspaceList() {
    workspaceList.value = await Workspaces.list();
  }

  async function removeWorkspace() {
    if (!workspace.value) return;

    const name = workspace.value;
    setWorkspace("");
    await Workspaces.delete(name);
    await reloadWorkspaceList();
  }

  async function reloadProject() {
    const name = workspace.value;
    if (!name) {
      project.value = null;
      tasks.value = [];
      return;
    }
    const [brief, taskList] = await Promise.all([Workspaces.project(name), Workspaces.tasks(name)]);
    if (workspace.value === name) {
      project.value = brief;
      tasks.value = taskList;
    }
  }

  async function createWorkspace(nameInput) {
    const { name } = await Workspaces.create(nameInput);
    await reloadWorkspaceList();
    await setWorkspace(name);
  }

  effect(
    () => workspace.value,
    () => reloadProject().catch(() => (project.value = null)),
  );

  return {
    workspace,
    workspaceList,
    project,
    tasks,
    reloadWorkspaceList,
    reloadProject,
    removeWorkspace,
    createWorkspace,
    setWorkspace,
  };
});
