import { computed, onInit } from '@li3/web';
import { signIn } from 'https://auth.api.apphor.de/index.mjs';
import { useWorkspaces } from '@app/store/workspaces.mjs';
import { useSessions } from '@app/store/sessions.mjs';
import { useProfile } from '@app/store/profile.mjs';

export default function () {
  const $ws = useWorkspaces();
  const $s = useSessions();
  const $p = useProfile();

  const wsList = computed(() => ($ws.workspaceList || []).map((ws) => ({ label: ws.name, value: ws.name })));
  const sessionList = computed(() => ($s.sessionList || []).map((s) => ({ label: s.title || s.id, value: s.id })));

  async function onCreateWorkspace() {
    const name = prompt('Name (optional)', '');

    if (name) {
      $ws.createWorkspace(name);
    }
  }

  async function onRemoveWorkspace() {
    if ($ws.workspace && confirm('Are you sure?')) {
      $ws.removeWorkspace();
    }
  }

  async function onDeleteSession() {
    if (!$s.sessionId || !confirm('Are you sure?')) return;

    await $s.deleteSession();
  }

  onInit(() => $p.reloadProfile());

  return {
    $ws,
    $s,
    $p,
    signIn: () => signIn(true),
    wsList,
    sessionList,
    onCreateWorkspace,
    onRemoveWorkspace,
    onDeleteSession,
  };
}
