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
  const pages = new Set(["workspaces", "chat", "integrations"]);
  const pageFromUrl = () => {
    const page = window.location.hash.slice(2);
    return pages.has(page) ? page : "workspaces";
  };
  const page = ref(pageFromUrl());
  if (!pages.has(window.location.hash.slice(2))) {
    window.history.replaceState(null, "", "#/workspaces");
  }
  window.addEventListener("popstate", () => {
    page.value = pageFromUrl();
  });
  const isCompact = ref(window.matchMedia("(max-width: 767px)").matches);
  const compactMediaQuery = window.matchMedia("(max-width: 767px)");
  compactMediaQuery.addEventListener("change", (event) => {
    isCompact.value = event.matches;
  });
  const toggleLayout = (x) => (layout.value[x] = !layout.value[x]);
  function navigate(nextPage) {
    if (!pages.has(nextPage) || page.value === nextPage) {
      return;
    }
    page.value = nextPage;
    window.history.pushState(null, "", `#/${nextPage}`);
  }
  const openChat = () => navigate("chat");
  const openSidebar = () => navigate("workspaces");
  const openIntegrations = () => navigate("integrations");

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
    page,
    isCompact,
    openChat,
    openSidebar,
    openIntegrations,
  };
});
