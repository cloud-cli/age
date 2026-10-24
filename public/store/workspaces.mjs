import { Workspaces } from "@app/api.mjs";
import { defineStore } from "@li3/store";
import { effect, hook, ref } from "@li3/web";

export const useWorkspaces = defineStore("workspaces", function () {
  const [workspace, setWorkspace] = hook("");
  const workspaceList = ref([]);
  const project = ref(null);
  const tasks = ref([]);
  let workspaceListRequest = 0;

  async function reloadWorkspaceList() {
    const request = ++workspaceListRequest;
    const list = await Workspaces.list();
    if (request === workspaceListRequest) {
      workspaceList.value = Array.isArray(list) ? list : [];
    }
  }

  async function removeWorkspace() {
    if (!workspace.value) return;

    const name = workspace.value;
    setWorkspace("");
    await Workspaces.delete(name);
    await reloadWorkspaceList();
    window.dispatchEvent(new Event("age:workspaces-changed"));
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
    const created = await Workspaces.create(nameInput);
    workspaceListRequest += 1;
    workspaceList.value = [...workspaceList.value.filter((workspace) => workspace.name !== created.name), created];
    setWorkspace(created.name);
    await reloadWorkspaceList();
    window.dispatchEvent(new Event("age:workspaces-changed"));
    return created;
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
