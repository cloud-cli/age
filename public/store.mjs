import { ref, hook, computed, watch } from "@li3/web";
import { events as authEvents, getProfile, getPropertyNS } from "https://auth.api.apphor.de/index.mjs";
import { defineStore } from "@li3/store";
import { Workspaces, Sessions, Models, setKey, events } from "@app/api.mjs";

function useWorkspaces() {
  const [workspace, setWorkspace] = hook("");
  const workspaceList = ref([]);

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

  async function createWorkspace(nameInput) {
    const { name } = await Workspaces.create(nameInput);
    await reloadWorkspaceList();
    await setWorkspace(name);
  }

  return { workspace, workspaceList, reloadWorkspaceList, removeWorkspace, createWorkspace, setWorkspace };
}

function useFiles({ workspace }) {
  const [files, setFiles] = hook([]);
  const [selectedFile, setSelectedFile] = hook(null);

  function setFileContent(c) {
    if (selectedFile.value) {
      selectedFile.value.content = c;
    }
  }

  async function loadFileContent() {
    const file = selectedFile.value;

    if (!file || file.loaded) { return; }

    try {
      file.content = await Workspaces.readFile(workspace.value, file.path);
      file.loaded = true;
    } finally {
      file.loaded = true;
    }
  }

  async function saveFileContent() {
    if (selectedFile.value) {
      const content = selectedFile.value.content;
      await Workspaces.writeFile(workspace.value, selectedFile.value.path, content);
    }
  }

  async function reloadFileList() {
    setSelectedFile(null);
    const name = workspace.value;

    if (!name) {
      setFiles([]);
      return;
    }

    setFiles(await Workspaces.read(name));
  }

  function addFileToSession() {
    const file = selectedFile.value;

    if (file) {
      const msg = {
        role: 'tool',
        tool_name: 'ReadFile',
        meta: { uid: crypto.randomUUID() },
        content: file.content,
      };

      setMessages([msg, ...messages.value]);
    }
  }

  return { setFileContent, loadFileContent, saveFileContent, reloadFileList, addFileToSession, setFiles, setSelectedFile, files };
}

function useMessages({ workspace, session }) {
  const [messages, setMessages] = hook([]);
  const [model, setModel] = hook("");
  const [modelList, setModelList] = hook("");

  async function reloadMessages() {
    if (workspace.value && session.value) {
      const json = await Sessions.read(workspace.value, session.value.id);
      setMessages(json.messages.reverse());
    } else {
      setMessages([]);
    }
  }

  async function deleteMessage(uid) {
    if (workspace.value && session.value) {
      await Sessions.deleteMessage(workspace.value, session.value.id, uid);
      await reloadMessages();
    }
  }

  async function sendMessage(message) {
    const spinner = { role: "user", content: message, meta: { thinking: true } };
    setMessages([spinner, ...messages.value]);
    const response = await Sessions.sendMessage(workspace.value, session.value.id, { message, model: model.value });
    setMessages(response.messages.reverse());
  }

  async function retryMessage() {
    const response = await Sessions.retry(workspace.value, session.value.id);
    setMessages(response.messages.reverse());
  }

  async function pullModel(name) {
    await Models.pull(name);
    await reloadModelList();
  }

  async function reloadModelList() {
    modelList.value = await Models.list();
  }

  return { messages, setMessages, reloadMessages, deleteMessage, sendMessage, retryMessage, model, setModel, pullModel, reloadModelList, modelList, setModelList };
}

export const useStore = defineStore("app", function () {
  const { workspace, workspaceList, reloadWorkspaceList, removeWorkspace, createWorkspace, setWorkspace } = useWorkspaces();
  const profile = ref(null);
  const [session, setSession] = hook(null);
  const sessionList = ref([]);
  const sessionId = computed(() => session.value?.id || null);

  const { setFileContent, loadFileContent, reloadFileList, addFileToSession, setFiles, selectedFile, setSelectedFile, files } = useFiles({ workspace });
  const { messages, setMessages, reloadMessages, deleteMessage, sendMessage, retryMessage, model, setModel, pullModel, modelList, setModelList, reloadModelList } = useMessages({ workspace, session });

  async function setProfile(v) {
    profile.value = v;
    setKey(v ? await getPropertyNS("authKey") : "");

    if (v) {
      await reloadWorkspaceList();
      await reloadModelList();
    }
  }

  async function setSessionById(id) {
    setSession(sessionList.value.find((s) => s.id === id));
    await reloadMessages();
  }

  async function createSession() {
    if (workspace.value) {
      const newSession = await Sessions.create(workspace.value);
      setSessionList(sessionList.value.concat(newSession));
      setSession(newSession);
    }
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
      setSessionList(await Sessions.list(workspace.value));
    }
  }

  function setSessionList(list) {
    sessionList.value = list;

    if (!list?.length) {
      setSessionById('');
      return;
    }

    const firstId = list && list[0]?.id;

    if (list.length === 1) {
      setSessionById(firstId);
    }

    if (list.length && !list.find((s) => s.id === sessionId.value)) {
      setSessionById(firstId);
    }
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

  watch(workspace, async () => {
    setMessages([]);
    setSession(null);
    setSessionList([]);
    setModel("");
    setSelectedFile(null);
    setFiles([]);
    await reloadSessionList();
    await reloadFileList();
  });

  return {
    workspace,
    setWorkspace,
    createWorkspace,
    removeWorkspace,

    workspaceList,
    reloadWorkspaceList,

    files,
    setFiles,
    reloadFileList,
    addFileToSession,

    selectedFile,
    setSelectedFile,
    setFileContent,
    loadFileContent,

    session,
    sessionId,
    setSessionById,
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
    retryMessage,
    deleteMessage,
    reloadMessages,

    profile,
    reloadProfile,

    pullModel,
  };
});
