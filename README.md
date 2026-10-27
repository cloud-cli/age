# Age

Age is an authenticated workspace for AI-assisted software work. It is being developed toward an OpenCode-inspired
agent workspace with a messaging-first interface.

## Product goals

1. **Workspace-first work.** Every workspace has a durable brief, goals, a planner conversation, and task records. The
   workspace settings and goal pages are the source of truth for progress, not an incidental chat.
2. **Planner-led execution.** A planner breaks workspace goals into explicit specialist tasks. Specialist work must be
   visible with a role, parent context, status, result, and clear ownership. Queued work must never be shown as
   running or complete.
3. **OpenCode-style tool use.** Agents can safely inspect and search a workspace and use bounded read, glob, grep,
   web fetch/search, shell, and editing tools. Mutating or consequential tools require an explicit approval policy.
4. **One focused conversation UI.** The interface uses one sidebar for workspaces, plus one messaging pane.
   It has no file tree, code editor, or multi-panel layout. It is inspired by the clarity of a modern messaging app,
   without using WhatsApp branding or assets.
5. **Voice-first, reviewable interaction.** Dictation creates an editable draft and never sends automatically. Reply
   read-aloud is opt-in, excludes tool output and reasoning, and works alongside typing.
6. **Secure, private access.** Users sign in through OIDC. Browser clients use an HttpOnly same-origin session instead
   of a shared API key; OIDC tokens and client secrets remain server-side.

## Current implementation status

- OIDC Authorization Code + PKCE sign-in, logout, and same-origin sessions are available.
- The sidebar contains the workspace list, sign-out action, and workspace creation button.
- Workspace settings provide an editable brief and goals; each goal has a task board with comments and status changes.
- Agents may append task comments and set a task's board status; other mutating tools remain behind the explicit policy gate.
- Messaging supports separate drafts per workspace/session, browser dictation, and optional browser TTS.
- Core agent tools include bounded numbered reads, glob, grep, public web fetch/search, and a policy-gated shell.
- Delegation currently persists **queued task records only**. Running specialist agents, result aggregation, durable
  multi-process locks, and planner-maintained workspace summaries are still required to reach the planner-led execution
  goal.

## Workspace layout

Each workspace is stored below `DATA_PATH`:

| Path                    | Purpose                                            |
| ----------------------- | -------------------------------------------------- |
| `history/`              | JSON conversation histories, one per session       |
| `files/`                | Agent workspace files (not exposed through the UI) |
| `config/workspace.json` | Workspace brief and goal records                   |
| `tasks/`                | Delegated-task records and status                  |

## Required runtime configuration

| Variable             | Purpose                                                      |
| -------------------- | ------------------------------------------------------------ |
| `OIDC_ISSUER`        | OpenID Connect issuer, normally `https://auth.api.apphor.de` |
| `OIDC_CLIENT_ID`     | Confidential OIDC client ID                                  |
| `OIDC_CLIENT_SECRET` | Confidential OIDC client secret                              |
| `OIDC_REDIRECT_URI`  | Registered callback URL, ending in `/auth/callback`          |
| `APP_ORIGIN`         | Canonical public HTTPS origin, used for CSRF origin checks   |
| `DATA_PATH`          | Persistent workspace storage root                            |
| `PORT`               | HTTP listener port                                           |

Optional runtime configuration includes `MODEL`, `APP_MESSAGE_HUB_URL`, `WEB_SEARCH_URL`, and
`WEB_SEARCH_API_KEY`. Mutating agent tools remain disabled unless `ALLOW_MUTATING_TOOLS=true` is deliberately set.
The Integrations page supports team-shared Gemini/OpenAI API keys, multiple named Ollama servers, and ChatGPT Plus/Pro
device authorization using the OpenCode-style device-code flow. ChatGPT credentials and provider keys are encrypted at
rest with `CONNECTOR_ENCRYPTION_KEY`.
The PWA supports pull-down-to-refresh and revalidates app assets on reload.

## Key routes

- `GET /auth/login`, `GET /auth/callback`, `POST /auth/logout` — OIDC session lifecycle
- `GET /api/me` — current authenticated user
- `POST /connectors/chatgpt/login` and `GET /connectors/chatgpt/login/:id` — ChatGPT device authorization
- `GET|POST|DELETE /workspaces` — workspace list and lifecycle
- `GET|POST|DELETE /workspaces/:name/history` — conversations
- `GET|PUT /workspaces/:name/settings` — durable description and goal settings
- `GET|POST /workspaces/:name/tasks`, `GET /workspaces/:name/tasks/:id`, and `PATCH /workspaces/:name/tasks/:id` — task list/detail and status
- `POST /workspaces/:name/tasks/:id/comments` — authenticated user comments; the server derives the author from the session

## Verification priorities

Before calling an iteration complete, verify OIDC login/logout, desktop and mobile workspace/session navigation,
workspace settings, goal and task flows, multi-phrase dictation-to-draft, opt-in TTS, queued-task labels, tool approval behavior,
and stale-request handling while switching conversations.
