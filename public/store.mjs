import { defineStore } from '@li3/store';
import { Workspaces, setKey } from "/public/index.mjs";
import { ref, hook } from '@li3/web';
import { signIn, events, getProfile, getPropertyNS } from "https://auth.api.apphor.de/index.mjs";

export const useStore = defineStore('app', function () {
  const profile = ref(null);
  const workspaceList = ref([]);
  const [workspace, setWorkspace] = hook('');
  const [sessionId, setSessionId] = hook('');
  const [files, setFiles] = hook([]);
  const [selectedFile, selectFile] = hook(null);

  function setContent(c) {
    if (selectedFile.value) selectedFile.value.content = c;
  }

  async function setProfile(v) {
    profile.value = v;
    setKey(v ? await getPropertyNS("authKey") : "");

    if (v) {
      await updateWorkspaceList();
    }
  }

  async function updateFileList() {
    selectFile(null);
    const name = workspace.value;

    if (!name) {
      store.setFiles([]);
      return;
    }

    setFiles(await Workspaces.read(name));
  }

  async function updateWorkspaceList() {
    workspaceList.value = await Workspaces.list();
  }

  async function removeWorkspace() {
    const name = workspace.value;
    await Workspaces.delete(name);
    workspaceList.value = workspaceList.value.filter((x) => x !== name);
    workspace.value = "";
  }

  async function createWorkspace(nameInput) {
    const { name } = await Workspaces.create(nameInput);
    await onReloadWorkspaceList();
    setWorkspace(name);
    selectFile(null);
    setFiles([]);
  }

  async function updateProfile() {
    try {
      setProfile(await getProfile());
    } catch { }
  }

  events.addEventListener("state", (e) => setProfile(e.detail));

  watch(workspace, updateFileList);

  return {
    profile,
    workspace,
    sessionId,
    files,
    selectedFile,

    setContent,
    updateFileList,
    updateWorkspaceList,
    updateProfile,
    setWorkspace,
    setSessionId,
    setFiles,
    selectFile,
    setProfile,
    removeWorkspace,
    createWorkspace,
  };
});