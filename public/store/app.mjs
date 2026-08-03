import { defineStore } from '@li3/store';
import { effect, ref } from '@li3/web';
import { useWorkspaces } from './workspaces.mjs';
import { useSessions } from './sessions.mjs';
import { useMessages } from './messages.mjs';
import { useFiles } from './files.mjs';
import { useProfile } from './profile.mjs';

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
