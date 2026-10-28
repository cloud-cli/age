import { events, Models, Sessions } from "@app/api.mjs";
import { useSessions } from "@app/store/sessions.mjs";
import { useWorkspaces } from "@app/store/workspaces.mjs";
import { defineStore } from "@li3/store";
import { computed, effect, hook, ref } from "@li3/web";

export const useMessages = defineStore("messages", function () {
  const $ws = useWorkspaces();
  const $session = useSessions();
  const [messages, setMessages] = hook([]);
  const [model, setModel] = hook("");
  const [modelList, setModelList] = hook("");
  const [sending, setSending] = hook(false);
  const agentStatus = ref({ sessionId: "", status: "idle", error: "" });
  const agentStatusLabel = computed(() => {
    if (agentStatus.value.sessionId !== $session.sessionId) {
      return "";
    }
    if (agentStatus.value.status === "working") {
      return "Working on a response…";
    }
    if (agentStatus.value.status === "complete") {
      return "Response complete";
    }
    if (agentStatus.value.status === "error") {
      return `Could not get a response: ${agentStatus.value.error}`;
    }
    return "";
  });
  const newMessage = ref("");
  const sendDisabled = computed(
    () => sending.value || !$ws.workspace || !$session.sessionId || !newMessage.value.trim(),
  );

  const drafts = new Map();

  function setNewMessage(v) {
    newMessage.value = v;
    drafts.set(`${$ws.workspace}:${$session.sessionId || ""}`, v);
  }

  async function reloadMessages() {
    const workspace = $ws.workspace;
    const sessionId = $session.sessionId;
    if (workspace && sessionId) {
      const json = await Sessions.read(workspace, sessionId);
      if ($ws.workspace === workspace && $session.sessionId === sessionId) {
        setMessages(json.messages || []);
      }
    } else {
      setMessages([]);
    }
  }

  async function deleteMessage(uid) {
    if ($ws.workspace && $session.session) {
      await Sessions.deleteMessage($ws.workspace, $session.sessionId, uid);
      await reloadMessages();
    }
  }

  async function sendMessage() {
    const message = newMessage.value;
    const workspace = $ws.workspace;
    const sessionId = $session.sessionId;

    if (!(workspace && sessionId && message)) {
      return;
    }

    try {
      setSending(true);
      agentStatus.value = { sessionId, status: "working", error: "" };
      setNewMessage("");
      const response = await Sessions.sendMessage(workspace, sessionId, {
        message,
        model: model.value,
      });
      if ($ws.workspace === workspace && $session.sessionId === sessionId) {
        setMessages([...messages.value, response]);
      }
    } catch (e) {
      if ($ws.workspace === workspace && $session.sessionId === sessionId) {
        setNewMessage(message);
        agentStatus.value = { sessionId, status: "error", error: e instanceof Error ? e.message : "Request failed" };
      }
      console.log(e);
    } finally {
      setSending(false);
    }
  }

  async function retryMessage() {
    const sessionId = $session.sessionId;
    agentStatus.value = { sessionId, status: "working", error: "" };
    try {
      await Sessions.retry($ws.workspace, sessionId);
    } catch (error) {
      agentStatus.value = {
        sessionId,
        status: "error",
        error: error instanceof Error ? error.message : "Request failed",
      };
    }
  }

  async function pullModel(name) {
    await Models.pull(name);
    await reloadModelList();
  }

  async function reloadModelList() {
    modelList.value = await Models.list();
    if (!modelList.value.some((item) => item.id === model.value)) {
      model.value = modelList.value.find((item) => item.default)?.id || "";
    }
  }

  effect(
    () => `${$ws.workspace}:${$session.sessionId || ""}`,
    (key) => setNewMessage(drafts.get(key) || ""),
  );

  effect(() => $session.sessionId, reloadMessages);

  events.addEventListener("message", (e) => {
    const { sessionId, message } = e.detail;
    if ($session.sessionId === sessionId) {
      messages.value = [...messages.value, message];
    }
  });
  events.addEventListener("agent-status", (event) => {
    const { sessionId, status, error = "" } = event.detail;
    if (sessionId === $session.sessionId) {
      agentStatus.value = { sessionId, status, error };
    }
  });

  return {
    messages,
    setMessages,
    newMessage,
    setNewMessage,
    sending,
    agentStatus,
    agentStatusLabel,
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
