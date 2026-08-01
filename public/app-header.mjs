import { computed, onInit } from '@li3/web';
import { signIn } from 'https://auth.api.apphor.de/index.mjs';
import { useStore } from '@app/store.mjs';

export default function () {
  const $ = useStore();
  const wsListMapped = computed(() => ($.workspaceList || []).map((ws) => ({ label: ws.name, value: ws.name })));
  const sessionListMapped = computed(() =>
    ($.sessionList || []).map((s) => ({ label: s.title || s.id, value: s.id })),
  );

  async function onCreateWorkspace() {
    const nameInput = prompt('Name (optional)', '') || undefined;
    $.createWorkspace(nameInput);
  }

  async function onRemoveWorkspace() {
    if ($.workspace && confirm('Are you sure?')) {
      $.removeWorkspace();
    }
  }

  async function onDeleteSession() {
    if (!$.sessionId || !confirm('Are you sure?')) return;

    await $.deleteSession();
  }

  onInit(() => $.reloadProfile());

  return {
    $,
    signIn,
    wsListMapped,
    sessionListMapped,
    onCreateWorkspace,
    onRemoveWorkspace,
    onDeleteSession,
  };
}
