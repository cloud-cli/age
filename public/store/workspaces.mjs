import { ref, hook } from '@li3/web';
import { defineStore } from '@li3/store';
import { Workspaces } from '@app/api.mjs';

export const useWorkspaces = defineStore('workspaces', function () {
  const [workspace, setWorkspace] = hook('');
  const workspaceList = ref([]);

  async function reloadWorkspaceList() {
    workspaceList.value = await Workspaces.list();
  }

  async function removeWorkspace() {
    if (!workspace.value) return;

    const name = workspace.value;
    setWorkspace('');
    await Workspaces.delete(name);
    await reloadWorkspaceList();
  }

  async function createWorkspace(nameInput) {
    const { name } = await Workspaces.create(nameInput);
    await reloadWorkspaceList();
    await setWorkspace(name);
  }

  return { workspace, workspaceList, reloadWorkspaceList, removeWorkspace, createWorkspace, setWorkspace };
});
