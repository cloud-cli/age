import { ref, computed, hook, templateRef, watch, onInit } from "@li3/web";
import { storeToRefs } from "@li3/store";
import { useStore } from "/public/store.mjs";

export default function () {
  const store = useStore();
  const { workspace, session, sessionList, model, modelList, messages } = storeToRefs(store);
  const modelSelector = templateRef("modelSelector");
  const sessionId = computed(() => session.value?.id || null);

  const sending = ref(false);
  const [newMessage, setMessage] = hook("");

  const sessionListMapped = computed(() =>
    (sessionList.value || []).map((s) => ({ label: s.title || s.id, value: s.id })),
  );

  const modelListMapped = computed(() => (modelList.value || []).map((m) => ({ label: m.id, value: m.id })));

  async function onSend() {
    const message = newMessage.value;

    if (!(workspace.value && sessionId.value && message)) return;

    try {
      sending.value = true;
      setMessage("");
      store.sendMessage(message);
    } catch (e) {
      setMessage(message);
      console.log(e);
    } finally {
      sending.value = false;
    }
  }

  async function onSetSessionId(id) {
    store.setSession(sessionList.value.find((s) => s.id === id));
  }

  async function onCreateSession() {
    store.createSession();
  }

  async function onDeleteSession() {
    if (!sessionId.value || !confirm("Are you sure?")) return;

    await store.deleteSession();
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
      await store.pullModel(name);
    } catch {
    } finally {
      modelSelector.value.spinning = false;
    }
  }

  onInit(onReloadModelList);
  watch(sessionList, (list = []) => {
    const firstId = list[0]?.id;

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
