import { ref, computed, hook, templateRef, watch, onInit } from "@li3/web";
import { storeToRefs } from "@li3/store";
import { useStore } from "@app/store.mjs";

export default function () {
  const store = useStore();
  const { workspace, session, sessionId, model, modelList, messages } = storeToRefs(store);
  const modelSelector = templateRef("modelSelector");
  const sending = ref(false);
  const [newMessage, setMessage] = hook("");
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

  async function onDeleteMessage(uid) {
    if (!uid || !confirm("Are you sure?")) {
      return;
    }

    await store.deleteMessage(uid);
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
    } finally {
      modelSelector.value.spinning = false;
    }
  }

  onInit(() => store.reloadModelList());

  return {
    store,
    workspace,
    messages,
    newMessage,
    setMessage,
    sending,
    session,
    model,
    modelListMapped,
    sessionListMapped,
    onSend,
    onKeyDown,
    onDeleteSession,
    onDeleteMessage,
    onPullModel,
  };
}
