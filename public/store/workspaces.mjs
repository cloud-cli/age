import { Workspaces } from "@app/api.mjs";
import { defineStore } from "@li3/store";
import { effect, hook, ref } from "@li3/web";

export const useWorkspaces = defineStore("workspaces", function () {
  const [workspace, setWorkspace] = hook("");
  const workspaceList = ref([]);
  const archivedWorkspaceList = ref([]);
  const tasks = ref([]);
  const settings = ref({ description: "", goals: [], repositoryUrl: "" });
  let workspaceListRequest = 0;

  async function reloadWorkspaceList() {
    const request = ++workspaceListRequest;
    const [list, archivedList] = await Promise.all([Workspaces.list(), Workspaces.list(true)]);
    if (request === workspaceListRequest) {
      workspaceList.value = Array.isArray(list) ? list : [];
      archivedWorkspaceList.value = (Array.isArray(archivedList) ? archivedList : []).filter((item) => item.archived);
    }
  }

  async function removeWorkspace() {
    if (!workspace.value) {
      return;
    }

    const name = workspace.value;
    setWorkspace("");
    await Workspaces.delete(name);
    await reloadWorkspaceList();
    window.dispatchEvent(new window.Event("age:workspaces-changed"));
  }

  async function archiveWorkspace(name = workspace.value) {
    await Workspaces.archive(name, true);
    if (workspace.value === name) {
      setWorkspace("");
    }
    await reloadWorkspaceList();
    window.dispatchEvent(new window.Event("age:workspaces-changed"));
  }

  async function restoreWorkspace(name) {
    await Workspaces.archive(name, false);
    await reloadWorkspaceList();
    window.dispatchEvent(new window.Event("age:workspaces-changed"));
  }

  async function reloadWorkspaceData() {
    const name = workspace.value;
    if (!name) {
      settings.value = { description: "", goals: [], repositoryUrl: "" };
      tasks.value = [];
      return;
    }
    const [taskList, workspaceSettings] = await Promise.all([Workspaces.tasks(name), Workspaces.settings(name)]);
    if (workspace.value === name) {
      tasks.value = taskList;
      settings.value = workspaceSettings;
    }
  }

  async function saveSettings(values) {
    const update = values.goals === undefined ? values : { ...values, revision: settings.value.revision || 0 };
    settings.value = await Workspaces.updateSettings(workspace.value, update);
    await reloadWorkspaceData();
  }

  async function createWorkspace(nameInput) {
    const created = await Workspaces.create(nameInput);
    workspaceListRequest += 1;
    workspaceList.value = [...workspaceList.value.filter((workspace) => workspace.name !== created.name), created];
    setWorkspace(created.name);
    await reloadWorkspaceList();
    window.dispatchEvent(new window.Event("age:workspaces-changed"));
    return created;
  }

  effect(
    () => workspace.value,
    () => reloadWorkspaceData().catch(console.error),
  );

  return {
    workspace,
    workspaceList,
    archivedWorkspaceList,
    tasks,
    settings,
    saveSettings,
    reloadWorkspaceList,
    reloadWorkspaceData,
    removeWorkspace,
    archiveWorkspace,
    restoreWorkspace,
    createWorkspace,
    setWorkspace,
  };
});
