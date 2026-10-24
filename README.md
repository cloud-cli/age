# Age

Age is an authenticated workspace for AI-assisted software work. It is being developed toward an OpenCode-inspired
agent workspace with a messaging-first interface.

## Product goals

1. **Project-first work.** Every project has a durable summary, goals, recent updates, next steps, a planner
   conversation, and task records. The project overview is the source of truth for progress, not an incidental chat.
2. **Planner-led execution.** A planner breaks project goals into explicit specialist tasks. Specialist work must be
   visible with a role, parent context, status, result, and clear ownership. Queued work must never be shown as
   running or complete.
3. **OpenCode-style tool use.** Agents can safely inspect and search a workspace and use bounded read, glob, grep,
   web fetch/search, shell, and editing tools. Mutating or consequential tools require an explicit approval policy.
4. **One focused conversation UI.** The interface uses one sidebar for projects and sessions, plus one messaging pane.
   It has no file tree, code editor, or multi-panel layout. It is inspired by the clarity of a modern messaging app,
   without using WhatsApp branding or assets.
5. **Voice-first, reviewable interaction.** Dictation creates an editable draft and never sends automatically. Reply
   read-aloud is opt-in, excludes tool output and reasoning, and works alongside typing.
6. **Secure, private access.** Users sign in through OIDC. Browser clients use an HttpOnly same-origin session instead
   of a shared API key; OIDC tokens and client secrets remain server-side.

## Current implementation status

- OIDC Authorization Code + PKCE sign-in, logout, and same-origin sessions are available.
- The single sidebar displays project briefs, sessions, planner entry points, and queued task records.
- Messaging supports separate drafts per project/session, browser dictation, and optional browser TTS.
- Core agent tools include bounded numbered reads, glob, grep, public web fetch/search, and a policy-gated shell.
- Delegation currently persists **queued task records only**. Running specialist agents, result aggregation, durable
  multi-process locks, and planner-maintained project summaries are still required to reach the planner-led execution
  goal.

## Workspace layout

Each workspace is stored below `DATA_PATH`:

| Path                  | Purpose                                            |
| --------------------- | -------------------------------------------------- |
| `history/`            | JSON conversation histories, one per session       |
| `files/`              | Agent workspace files (not exposed through the UI) |
| `config/project.json` | Project summary, goals, updates, and next steps    |
| `tasks/`              | Delegated-task records and status                  |

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
The Integrations page supports per-user Gemini/OpenAI API keys and multiple named Ollama servers, including per-server
model discovery, connection checks, and disconnect. Set `CONNECTOR_ENCRYPTION_KEY` to a stable secret to encrypt
credentials at rest.
ChatGPT Plus OAuth sign-in is not wired up yet. The PWA supports pull-down-to-refresh and revalidates app assets on
reload.

## Key routes

- `GET /auth/login`, `GET /auth/callback`, `POST /auth/logout` — OIDC session lifecycle
- `GET /api/me` — current authenticated user
- `GET|POST|DELETE /workspaces` — project workspaces
- `GET|POST|DELETE /workspaces/:name/history` — conversations
- `GET /workspaces/:name/project` and `GET /workspaces/:name/tasks` — project state

## Verification priorities

Before calling an iteration complete, verify OIDC login/logout, desktop and mobile project/session navigation,
project overview content, multi-phrase dictation-to-draft, opt-in TTS, queued-task labels, tool approval behavior,
and stale-request handling while switching conversations.
