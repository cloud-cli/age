import { Workspaces } from "@app/api.mjs";
import { defineStore } from "@li3/store";
import { effect, hook, ref } from "@li3/web";

export const useWorkspaces = defineStore("workspaces", function () {
  const [workspace, setWorkspace] = hook("");
  const workspaceList = ref([]);
  const project = ref(null);

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
    project.value = workspace.value ? await Workspaces.project(workspace.value) : null;
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
    reloadWorkspaceList,
    reloadProject,
    removeWorkspace,
    createWorkspace,
    setWorkspace,
  };
});
