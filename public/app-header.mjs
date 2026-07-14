import { ref, computed, onInit, onDestroy, defineProp, defineEvent } from "@li3/web";
import { signIn } from "https://auth.api.apphor.de/index.mjs";
import { storeToRefs } from "@li3/store";
import { useStore } from "/public/store.mjs";

export default function () {
  const eventSource = new EventSource("/:events");
  onDestroy(() => eventSource.close());

  eventSource.onmessage = (e) => {
    console.log(e.data);
  };

  const store = useStore();
  const { profile, workspace, workspaceList } = storeToRefs(store);

  const wsListMapped = computed(() =>
    (workspaceList.value || []).map((ws) => ({ label: ws.name, value: ws.name })),
  );

  async function onCreateWorkspace() {
    const nameInput = prompt("Name (optional)", "") || undefined;
    store.createWorkspace(nameInput);
  }

  async function onReloadWorkspaceList() {
    store.updateWorkspaceList();
  }

  async function onRemoveWorkspace() {
    if (workspace.value && confirm("Are you sure?")) {
      store.removeWorkspace();
    }
  }

  function onSelectWorkspace(v) {
    store.setWorkspace(v);
  }

  onInit(() => store.updateProfile());

  return {
    signIn,
    profile,
    workspace,
    wsListMapped,
    onCreateWorkspace,
    onReloadWorkspaceList,
    onSelectWorkspace,
    onRemoveWorkspace,
  };
}