import { Workspaces } from '@app/api.mjs';
import { useWorkspaces } from '@app/store/workspaces.mjs';
import { defineStore } from '@li3/store';
import { hook, ref } from '@li3/web';

export const useFiles = defineStore('files', function () {
  const $ = useWorkspaces();
  const [expanded, setExpanded] = hook([]);
  const [files, setFiles] = hook([]);
  const selectedFile = ref(null);

  function setSelectedFile(f) {
    selectedFile.value = f;
    loadFileContent();
  }

  function setFileContent(c) {
    if (selectedFile.value) {
      selectedFile.value.content = c;
    }
  }

  async function loadFileContent() {
    const file = selectedFile.value;

    if (!file || file.loaded) {
      return;
    }

    try {
      file.content = await Workspaces.readFile($.workspace, file.path);
      file.loaded = true;
    } finally {
      file.loaded = true;
    }
  }

  async function saveFileContent() {
    if (selectedFile.value) {
      const content = selectedFile.value.content;
      await Workspaces.writeFile($.workspace, selectedFile.value.path, content);
    }
  }

  async function reloadFileList() {
    setSelectedFile(null);
    const name = $.workspace;

    if (!name) {
      setFiles([]);
      return;
    }

    setFiles(await Workspaces.read(name));
  }

  function addFileToSession() {
    const file = selectedFile.value;

    if (file) {
      const msg = {
        role: 'tool',
        tool_name: 'ReadFile',
        meta: { uid: crypto.randomUUID() },
        content: file.content,
      };

      setMessages([msg, ...messages.value]);
    }
  }

  return {
    setFileContent,
    loadFileContent,
    saveFileContent,
    reloadFileList,
    addFileToSession,
    setFiles,
    selectedFile,
    setSelectedFile,
    files,
    expanded,
    setExpanded,
  };
});
