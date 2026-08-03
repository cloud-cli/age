import { Sessions } from '@app/api.mjs';
import { useWorkspaces } from '@app/store/workspaces.mjs';
import { defineStore } from '@li3/store';
import { computed, hook, ref } from '@li3/web';

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

  return {
    session,
    setSessionById,
    createSession,
    deleteSession,
    reloadSessionList,
    setSessionList,
  };
});
