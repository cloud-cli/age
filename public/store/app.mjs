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
  const pages = new Set(["workspaces", "overview", "settings", "goal", "sessions", "tasks", "chat", "integrations"]);
  const locationFromUrl = () => {
    const [route, query = ""] = window.location.hash.slice(2).split("?", 2);
    const params = new globalThis.URLSearchParams(query);
    return {
      page: pages.has(route) ? route : "workspaces",
      workspace: params.get("workspace") || "",
      goalId: params.get("goal") || "",
    };
  };
  const initialLocation = locationFromUrl();
  const page = ref(initialLocation.page);
  const goalId = ref(initialLocation.goalId);
  if (initialLocation.workspace) {
    workspaces.setWorkspace(initialLocation.workspace);
  }
  const locationIsValid = pages.has(window.location.hash.slice(2).split("?", 2)[0]);
  if (!locationIsValid) {
    window.history.replaceState(null, "", "#/workspaces");
  }
  function locationHash(nextPage, selectedWorkspace = workspaces.workspace, selectedGoal = goalId.value) {
    const params = new globalThis.URLSearchParams();
    if (selectedWorkspace) {
      params.set("workspace", selectedWorkspace);
    }
    if (nextPage === "goal" && selectedGoal) {
      params.set("goal", selectedGoal);
    }
    const query = params.toString();
    return `#/${nextPage}${query ? `?${query}` : ""}`;
  }
  window.addEventListener("popstate", () => {
    const location = locationFromUrl();
    page.value = location.page;
    goalId.value = location.goalId;
    workspaces.setWorkspace(location.workspace);
  });
  const isCompact = ref(window.matchMedia("(max-width: 767px)").matches);
  const compactMediaQuery = window.matchMedia("(max-width: 767px)");
  compactMediaQuery.addEventListener("change", (event) => {
    isCompact.value = event.matches;
  });
  const toggleLayout = (x) => (layout.value[x] = !layout.value[x]);
  function navigate(nextPage) {
    if (!pages.has(nextPage)) {
      return;
    }
    if (nextPage === page.value) {
      const hash = locationHash(nextPage);
      if (window.location.hash !== hash) {
        window.history.replaceState(null, "", hash);
      }
      return;
    }
    page.value = nextPage;
    if (nextPage !== "goal") {
      goalId.value = "";
    }
    window.history.pushState(null, "", locationHash(nextPage));
  }
  function openWorkspace(name) {
    workspaces.setWorkspace(name);
    goalId.value = "";
    page.value = "overview";
    window.history.pushState(null, "", locationHash("overview", name, ""));
  }
  const openChat = () => navigate("chat");
  const openSidebar = () => navigate("workspaces");
  const openIntegrations = () => navigate("integrations");
  const openOverview = () => navigate("overview");
  const openWorkspaceSettings = () => navigate("settings");
  function openGoal(id) {
    if (!id) {
      return;
    }
    goalId.value = id;
    page.value = "goal";
    window.history.pushState(null, "", locationHash("goal", workspaces.workspace, id));
  }
  const openSessions = () => navigate("sessions");
  const openTasks = () => navigate("tasks");

  effect(
    () => profile.profile,
    async (v) => {
      if (v) {
        await workspaces.reloadWorkspaceList();
        await messages.reloadModelList();
        await workspaces.reloadWorkspaceData();
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
        await Promise.all([sessions.reloadSessionList(), messages.reloadModelList()]);
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
    openOverview,
    openWorkspaceSettings,
    openGoal,
    openWorkspace,
    goalId,
    openSessions,
    openTasks,
  };
});
