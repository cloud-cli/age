import { defineStore } from "@li3/store";
import { Workspaces, Sessions, setKey, events } from "/public/index.mjs";
import { ref, hook } from "@li3/web";
import { events as authEvents, getProfile, getPropertyNS } from "https://auth.api.apphor.de/index.mjs";

export const useStore = defineStore("app", function () {
  const profile = ref(null);
  const workspaceList = ref([]);
  const workspace = ref("");
  const [files, setFiles] = hook([]);
  const [selectedFile, selectFile] = hook(null);
  const session = ref(null);
  const [sessionList, setSessionList] = hook([]);
  const [model, setModel] = hook("");
  const [modelList, setModelList] = hook("");
  const [messages, setMessages] = hook([]);

  function setFileContent(c) {
    if (selectedFile.value) selectedFile.value.content = c;
  }

  async function setProfile(v) {
    profile.value = v;
    setKey(v ? await getPropertyNS("authKey") : "");

    if (v) {
      await reloadWorkspaceList();
    }
  }

  async function reloadFileList() {
    selectFile(null);
    const name = workspace.value;

    if (!name) {
      store.setFiles([]);
      return;
    }

    setFiles(await Workspaces.read(name));
  }

  async function reloadWorkspaceList() {
    workspaceList.value = await Workspaces.list();
  }

  async function removeWorkspace() {
    const name = workspace.value;
    await Workspaces.delete(name);
    workspaceList.value = workspaceList.value.filter((x) => x !== name);
    setWorkspace("");
  }

  async function createWorkspace(nameInput) {
    const { name } = await Workspaces.create(nameInput);
    await onReloadWorkspaceList();
    setWorkspace(name);
    selectFile(null);
    setFiles([]);
  }

  async function setWorkspace(id) {
    workspace.value = id;
    setMessages([]);
    setSession(null);
    setSessionList([]);
    setModel("");
    await reloadSessionList();
    await reloadFileList();
  }

  async function reloadMessages() {
    if (workspace.value && session.value) {
      const json = await Sessions.read(workspace.value, session.value.id);
      setMessages(json.messages.reverse());
    }
  }

  async function reloadModelList() {
    modelList.value = await Models.list();
  }

  function setSession(id) {
    reloadMessages();
  }

  async function createSession() {
    const newSession = await Sessions.create(ws.value);
    setSessionList(sessionList.value.concat(newSession));
    setSession(newSession);
  }

  async function deleteSession() {
    if (session.value) {
      await Sessions.delete(workspace.value, session.value.id);
      setSession(null);
      await reloadSessions();
    }
  }

  async function reloadSessionList() {
    if (workspace.value) {
      sessionList.value = await Sessions.list(ws.value);
    }
  }

  async function deleteMessage(uid) {
    if (!uid || !confirm("Are you sure?")) {
      return;
    }

    if (workspace.value && session.value) {
      await Sessions.deleteMessage(workspace.value, session.value.id, uid);
      await reloadMessages();
    }
  }

  async function pullModel(name) {
    await Models.pull(name);
    await reloadModelList();
  }

  async function sendMessage(message) {
    const a = { role: "assistant", content: "", meta: { thinking: true } };
    const b = { role: "user", content: message };
    setMessages([a, b, ...messages.value]);
    const response = await Sessions.sendMessage(workspace.value, session.value.id, { message, model: model.value });
    setMessages([b, ...list]);
    store.setMessages(response.messages.reverse());
  }

  async function reloadProfile() {
    try {
      setProfile(await getProfile());
    } catch { }
  }

  authEvents.addEventListener("state", (e) => setProfile(e.detail));

  events.addEventListener("message", function onIncomingMessage(m) {
    if (session.value?.id === m.sessionId) {
      setMessages([m.message, ...messages.value]);
    }
  });

  return {
    workspace,
    setWorkspace,
    createWorkspace,
    removeWorkspace,
    reloadWorkspaceList,

    files,
    setFiles,
    reloadFileList,

    selectedFile,
    selectFile,
    setFileContent,

    session,
    setSession,
    createSession,
    deleteSession,

    sessionList,
    setSessionList,
    reloadSessionList,

    model,
    setModel,

    modelList,
    setModelList,
    reloadModelList,

    messages,
    setMessages,
    sendMessage,
    deleteMessage,

    profile,
    reloadProfile,

    pullModel,
  };
});
