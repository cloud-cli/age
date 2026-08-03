import { Models, Sessions } from '@app/api.mjs';
import { useSessions } from '@app/store/sessions.mjs';
import { useWorkspaces } from '@app/store/workspaces.mjs';
import { defineStore } from '@li3/store';
import { computed, effect, hook, ref } from '@li3/web';
import { events } from './api.mjs';

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

  async function sendMessage() {
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
