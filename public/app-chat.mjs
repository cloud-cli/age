import { ref, computed, hook, templateRef, watch, onInit, onDestroy, defineProp, defineEvent } from "@li3/web";
import { Sessions, Models, events } from "https://agents.apphor.de/index.mjs";

export default function () {
  const modelSelector = templateRef("modelSelector");
  const ws = defineProp("workspace");
  const session = ref(null);
  const sessionId = computed(() => session.value?.id || null);
  const sessionList = ref([]);
  const sending = ref(false);
  const [newMessage, setMessage] = hook("");
  const messages = ref([]);
  const modelList = ref([]);
  const [model, onSelectModel] = hook("");
  const sessionListMapped = computed(() =>
    (sessionList.value || []).map((s) => ({ label: s.title || s.id, value: s.id })),
  );

  const modelListMapped = computed(() => (modelList.value || []).map((m) => ({ label: m.id, value: m.id })));

  function onIncomingMessage(m) {
    if (sessionId.value === m.sessionId) {
      messages.value = [m.message, ...messages.value];
    }
  }

  events.addEventListener("message", onIncomingMessage);
  onDestroy(() => events.removeEventListener("message", onIncomingMessage));

  async function onSend() {
    const message = newMessage.value;

    if (!(ws.value && sessionId.value && message)) return;

    try {
      sending.value = true;
      messages.value = [
        { role: "assistant", content: "", meta: { thinking: true } },
        { role: "user", content: message },
        ...messages.value,
      ];
      setMessage("");
      const response = await Sessions.sendMessage(ws.value, sessionId.value, { message, model: model.value });
      messages.value = response.messages.reverse();
    } catch (e) {
      setMessage(message);
      console.log(e);
    } finally {
      sending.value = false;
    }
  }

  async function onSetSessionId(id) {
    session.value = sessionList.value.find((s) => s.id === id);

    if (!session.value) {
      messages.value = [];
    }
  }

  async function onCreateSession() {
    const newSession = await Sessions.create(ws.value);
    sessionList.value = sessionList.value.concat(newSession);
    session.value = newSession;
  }

  async function onDeleteSession() {
    if (!sessionId.value) return;
    if (!confirm("Are you sure?")) return;

    await Sessions.delete(ws.value, sessionId.value);
    onSetSessionId("");
    await onReloadSessions();
  }

  async function onReloadMessages() {
    if (ws.value && sessionId.value) {
      const json = await Sessions.read(ws.value, sessionId.value);
      messages.value = json.messages.reverse();
    }
  }

  async function onReloadModelList() {
    modelList.value = await Models.list();
  }

  async function onReloadSessions() {
    if (ws.value) {
      sessionList.value = await Sessions.list(ws.value);
    }
  }

  async function onDeleteMessage(uid) {
    if (!uid || !confirm("Are you sure?")) {
      return;
    }

    if (ws.value && sessionId.value) {
      await Sessions.deleteMessage(ws.value, sessionId.value, uid);
      await onReloadMessages();
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onSend();
    }
  }

  async function onPullModel() {
    const name = prompt("Model name", "");

    if (!name) {
      return;
    }

    try {
      modelSelector.value.spinning = true;
      await Models.pull(name);
    } catch {
    } finally {
      modelSelector.value.spinning = false;
    }
  }

  onInit(onReloadModelList);
  watch(session, (v) => v && onReloadMessages());
  watch(ws, () => {
    messages.value = [];
    session.value = null;
    sessionList.value = [];
    setMessage("");
    onSelectModel("");
    onReloadSessions();
  });

  watch(sessionList, (list = []) => {
    const firstId = sessionList[0]?.id;

    if (!firstId) return;

    if (list.length === 1) {
      onSetSessionId(firstId);
    }

    if (list.length && !list.find((s) => s.id === sessionId.value)) {
      onSetSessionId(firstId);
    }
  });

  return {
    messages,
    newMessage,
    setMessage,
    sending,
    session,
    sessionList,
    model,
    modelListMapped,
    sessionListMapped,
    onReloadModelList,
    onReloadSessions,
    onSend,
    onKeyDown,
    onSetSessionId,
    onDeleteSession,
    onCreateSession,
    onSelectModel,
    onPullModel,
    onReloadMessages,
    onDeleteMessage,
  };
}
