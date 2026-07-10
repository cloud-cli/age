# age

Workspaces for AI Agents

## Design

The API allows to create/read/update/delete a workspace.
Each workspace has several threads (chat history)
Only one agent can run at a time in a workspace to avoid conflicts

A workspace has the following folders:

| folder   | content                                         |
| -------- | ----------------------------------------------- |
| /history | JSON files with chat history (one per session)  |
| /files   | The actual working area with persistent storage |

## API

### /workspaces

CRUD to manage workspaces

### /workspaces/:name/sessions

Manage current session and previous chats
