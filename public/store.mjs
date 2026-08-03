import { ref, hook, computed, effect } from '@li3/web';
import { events as authEvents, getProfile, getPropertyNS } from 'https://auth.api.apphor.de/index.mjs';
import { defineStore } from '@li3/store';
import { Workspaces, Sessions, Models, setKey } from '@app/api.mjs';
import { events } from './api.mjs';

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

export const useSessions = defineStore('sessions', function () {
  const $ = useWorkspaces();
  const [session, setSession] = hook(null);
  const sessionList = ref([]);
  const sessionId = computed(() => session.value?.id || null);

  async function setSessionById(id) {
    setSession(sessionList.value.find((s) => s.id === id));
    await reloadMessages();
  }

  async function createSession() {
    if ($.workspace) {
      const newSession = await Sessions.create($.workspace);
      setSessionList(sessionList.value.concat(newSession));
      setSession(newSession);
    }
  }

  async function deleteSession() {
    if (session.value) {
      await Sessions.delete($.workspace, session.value.id);
      setSession(null);
      await reloadSessions();
    }
  }

  async function reloadSessionList() {
    if ($.workspace) {
      setSessionList(await Sessions.list($.workspace));
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

  return { setSessionById, createSession, deleteSession, reloadSessionList, setSessionList };
});

defineStore('profile', function () {
  const profile = ref(null);

  async function setProfile(v) {
    profile.value = v;
    setKey(v ? await getPropertyNS('authKey') : '');
  }

  async function reloadProfile() {
    try {
      setProfile(await getProfile());
    } catch {}
  }

  authEvents.addEventListener('state', (e) => profile.setProfile(e.detail));

  return { profile, setProfile, reloadProfile };
});

export const useFiles = defineStore('files', function () {
  const $ = useWorkspaces();
  const [expanded, setExpanded] = hook([]);
  const [files, setFiles] = hook([]);
  const selectedFile = ref(null);

  function setSelectedFile(f) {
    selectedFile.value = f;
    loadFileContent();
  }

  function setFileContent(c) {
    if (selectedFile.value) {
      selectedFile.value.content = c;
    }
  }

  async function loadFileContent() {
    const file = selectedFile.value;

    if (!file || file.loaded) {
      return;
    }

    try {
      file.content = await Workspaces.readFile($.workspace, file.path);
      file.loaded = true;
    } finally {
      file.loaded = true;
    }
  }

  async function saveFileContent() {
    if (selectedFile.value) {
      const content = selectedFile.value.content;
      await Workspaces.writeFile($.workspace, selectedFile.value.path, content);
    }
  }

  async function reloadFileList() {
    setSelectedFile(null);
    const name = $.workspace;

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

  return {
    setFileContent,
    loadFileContent,
    saveFileContent,
    reloadFileList,
    addFileToSession,
    setFiles,
    selectedFile,
    setSelectedFile,
    files,
  };
});

export const useMessages = defineStore('messages', function () {
  const $ws = useWorkspaces();
  const $session = useSessions();
  const [messages, setMessages] = hook([]);
  const [model, setModel] = hook('');
  const [modelList, setModelList] = hook('');
  const [sending, setSending] = hook(false);
  const newMessage = ref('');
  const sendDisabled = computed(
    () => sending.value || !$ws.workspace || !$session.sessionId || !newMessage.value.trim(),
  );

  const drafts = new Map();

  function setNewMessage(v) {
    newMessage.value = v;
    drafts.set($ws.workspace, v);
  }

  effect(
    () => $ws.workspace,
    (v) => v && setNewMessage(drafts.get(v) || ''),
  );

  async function reloadMessages() {
    if (workspace.value && session.value) {
      const json = await Sessions.read($ws.workspace.value, $sessions.sessionId);
      setMessages(json.messages.reverse());
    } else {
      setMessages([]);
    }
  }

  async function deleteMessage(uid) {
    if (workspace.value && session.value) {
      await Sessions.deleteMessage($ws.workspace.value, $sessions.sessionId, uid);
      await reloadMessages();
    }
  }

  async function sendMessage(message) {
    const message = newMessage.value;

    if (!($ws.workspace.value && $sessions.sessionId && message)) return;

    try {
      setSending(true);
      setNewMessage('');
      const response = await Sessions.sendMessage($ws.workspace.value, $sessions.sessionId, {
        message,
        model: model.value,
      });
      setMessages([response, ...messages.value]);
    } catch (e) {
      setNewMessage(message);
      console.log(e);
    } finally {
      setSending(false);
    }
  }

  async function retryMessage() {
    Sessions.retry($ws.workspace.value, $sessions.sessionId);
  }

  async function pullModel(name) {
    await Models.pull(name);
    await reloadModelList();
  }

  async function reloadModelList() {
    modelList.value = await Models.list();
  }

  events.addEventListener('message', (e) => {
    const { sessionId, message } = e.detail;
    if ($sessions.sessionId === sessionId) {
      messages.value = [message, ...messages.value];
    }
  });

  return {
    messages,
    setMessages,
    newMessage,
    setNewMessage,
    sending,
    sendDisabled,
    reloadMessages,
    deleteMessage,
    sendMessage,
    retryMessage,
    model,
    setModel,
    pullModel,
    reloadModelList,
    modelList,
    setModelList,
  };
});

export const useApp = defineStore('app', function () {
  const workspaces = useWorkspaces();
  const sessions = useSessions();
  const files = useFiles();
  const messages = useMessages();
  const profile = useProfile();
  const layout = ref({ left: true, center: true, right: true });
  const toggleLayout = (x) => (layout.value[x] = !layout.value[x]);

  effect(
    () => profile.profile,
    async (v) => {
      if (v) {
        await workspaces.reloadWorkspaceList();
        await messages.reloadModelList();
      }
    },
  );

  effect(
    () => workspaces.workspace,
    async () => {
      messages.setMessages([]);
      sessions.setSession(null);
      sessions.setSessionList([]);
      messages.setModel('');
      files.setSelectedFile(null);
      files.setFiles([]);
      await sessions.reloadSessionList();
      await files.reloadFileList();
    },
  );

  return {
    layout,
    toggleLayout,
  };
});
