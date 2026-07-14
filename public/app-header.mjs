import { computed, onInit } from "@li3/web";
import { signIn } from "https://auth.api.apphor.de/index.mjs";
import { storeToRefs } from "@li3/store";
import { useStore } from "@app/store.mjs";

export default function () {
  const store = useStore();
  const { profile, workspace, workspaceList, sessionList, sessionId } = storeToRefs(store);

  const wsListMapped = computed(() =>
    (workspaceList.value || []).map((ws) => ({ label: ws.name, value: ws.name })),
  );

  const sessionListMapped = computed(() =>
    (sessionList.value || []).map((s) => ({ label: s.title || s.id, value: s.id })),
  );

  async function onCreateWorkspace() {
    const nameInput = prompt("Name (optional)", "") || undefined;
    store.createWorkspace(nameInput);
  }

  async function onReloadWorkspaceList() {
    store.reloadWorkspaceList();
  }

  async function onRemoveWorkspace() {
    if (workspace.value && confirm("Are you sure?")) {
      store.removeWorkspace();
    }
  }

  function onSelectWorkspace(v) {
    store.setWorkspace(v);
  }

  onInit(() => store.reloadProfile());

  return {
    store,
    signIn,
    profile,
    workspace,
    sessionId,
    wsListMapped,
    sessionListMapped
    onCreateWorkspace,
    onReloadWorkspaceList,
    onSelectWorkspace,
    onRemoveWorkspace,
  };
}