import { defineStore } from "@li3/store";
import { effect, ref } from "@li3/web";
import { useWorkspaces } from "./workspaces.mjs";
import { useSessions } from "./sessions.mjs";
import { useMessages } from "./messages.mjs";
import { useProfile } from "./profile.mjs";

export const useApp = defineStore("app", function () {
  const workspaces = useWorkspaces();
  const sessions = useSessions();
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
      sessions.setSessionById("");
      sessions.setSessionList([]);
      messages.setModel("");
      await sessions.reloadSessionList();
    },
  );

  return {
    layout,
    toggleLayout,
  };
});
