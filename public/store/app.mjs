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
  const chatVisible = ref(false);
  const isCompact = ref(window.matchMedia("(max-width: 767px)").matches);
  const compactMediaQuery = window.matchMedia("(max-width: 767px)");
  compactMediaQuery.addEventListener("change", (event) => {
    isCompact.value = event.matches;
  });
  const toggleLayout = (x) => (layout.value[x] = !layout.value[x]);
  const openChat = () => (chatVisible.value = true);
  const openSidebar = () => (chatVisible.value = false);

  effect(
    () => profile.profile,
    async (v) => {
      if (v) {
        await workspaces.reloadWorkspaceList();
        await messages.reloadModelList();
        await workspaces.reloadProject();
        await sessions.reloadSessionList();
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
      if (workspaces.workspace) {
        await Promise.all([sessions.reloadSessionList(), messages.reloadModelList(), workspaces.reloadProject()]);
      }
    },
  );

  return {
    layout,
    toggleLayout,
    chatVisible,
    isCompact,
    openChat,
    openSidebar,
  };
});
