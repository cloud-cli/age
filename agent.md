# Product Goal and Delivery Plan

## The goal

**Age will replace OpenCode completely for our team.** A user must be able to describe an outcome as a goal, have the integrated planner turn it into clear tasks, and have production-ready agents and models carry those tasks through implementation and review. Completed work must be committed to the workspace's integrated local Git repository. After the user pushes, the platform's integrated CI/CD must deploy the change and refresh the running application seamlessly.

This is an end-to-end product goal, not a claim that every part is already complete. Build toward it in safe, observable steps: users approve consequential actions, can inspect every task and result, and can recover from failures without losing work.

## End-to-end success criteria

- A user can create and refine a durable goal in a workspace.
- The planner turns the goal into an ordered, appropriately sized task plan with explicit acceptance criteria, dependencies, and ownership.
- The platform selects available production models and agents for those tasks, runs them reliably, and shows queued, active, blocked, completed, and independently verified states accurately.
- Agents can work in the intended workspace checkout, run relevant checks, and return reviewable changes. The user can inspect diffs and approve or request revisions.
- Approved changes can be committed to the local Git repository with a meaningful message. Pushes go to the explicitly linked remote and branch; credentials are protected and push/deploy actions are visible and approval-gated.
- The integrated CI/CD pipeline reports build, test, and deployment status in the workspace. On success, the application refreshes or becomes available at its deployment target and passes a health/smoke check. Failures are surfaced with actionable logs and do not falsely report success.
- The complete workflow is secure, auditable, recoverable, and usable on desktop and mobile. Existing OpenCode workflows are mapped, parity gaps are tracked, and users can move their work without losing history or repositories.

## Delivery plan

### 1. Define replacement scope and baseline

- Inventory the OpenCode workflows and capabilities our users rely on; classify each as required for replacement, intentionally out of scope, or a later enhancement.
- Map current Age behavior against the journey: goal → plan → tasks → agent/model execution → review → local commit → push → CI/CD → deployment refresh and smoke test.
- Document data ownership, supported Git providers/branches, deployment targets, approval boundaries, audit events, recovery expectations, and service-level expectations.
- Record baseline tests and known gaps. Keep README implementation status aligned with actual behavior.

**Acceptance:** A reviewed parity matrix and prioritized gap list exist; every consequential step has a named owner, a safety policy, and a testable expected result.

### 2. Make goals produce dependable plans

- Improve goal creation/editing so goals have a clear outcome, context, constraints, and measurable acceptance criteria.
- Have the planner create structured tasks with dependencies, scope, expected artifacts, checks, and completion criteria; support plan review and editing before execution.
- Prevent duplicate, contradictory, or unbounded task creation; preserve goal/task relationships and plan revisions.
- Show plan progress and blockers in the workspace, with useful empty, loading, and error states.

**Acceptance:** A user can review and adjust a generated plan before workers run; persisted tasks accurately represent the approved plan after reload and retry.

### 3. Operationalize agents and models

- Inventory integrated agents, model providers, credentials, and production availability; expose capability and health status without leaking secrets.
- Route tasks to suitable agents/models using declared capabilities, availability, cost/latency policy, and user/team preferences; provide safe fallback behavior.
- Make task execution durable across restarts, with leases, bounded retries, cancellation, timeouts, and clear blocked/error states.
- Keep workers scoped to their task and workspace. Enforce tool permissions and approval policies server-side; never treat model output as authorization.
- Capture concise progress, outputs, changed-file evidence, logs, and independent review results for users.

**Acceptance:** Production-configured tasks complete or fail truthfully and recoverably; users can identify the agent/model, see evidence, and intervene without exposing provider credentials.

### 4. Complete the Git working loop

- Define workspace checkout creation, branch policy, remote linking, and behavior for existing or dirty repositories.
- Add safe status/diff inspection and conflict handling; run task-appropriate checks before presenting changes for approval.
- Support explicit approval, meaningful local commits, and commit history linked to goal/task records.
- Support authenticated pushes to the selected remote/branch with protected credentials, clear confirmation, and auditable outcomes.
- Handle rejected pushes, non-fast-forward updates, and interrupted operations without discarding user changes.

**Acceptance:** An approved task can be traced to its diff and local commit, and an explicitly authorized push reaches only the selected repository and branch; failures preserve the checkout and explain recovery steps.

### 5. Integrate CI/CD and seamless refresh

- Document and integrate with the platform's existing CI/CD API and project workflow; associate runs with the pushed commit and workspace goal.
- Display queued/running/succeeded/failed/cancelled status and relevant logs. Do not infer deployment success from a successful push or build alone.
- Connect successful deployment completion to the appropriate app refresh/revalidation behavior and deployment URL.
- Run a project-appropriate health check and minimal smoke test; report unavailable targets or failed checks explicitly.
- Define retry and rollback/escalation behavior with safe approvals for production-impacting actions.

**Acceptance:** A user can follow one commit from push through CI/CD and deployment; success is shown only after the intended target is healthy, and failures retain diagnostics and a safe next action.

### 6. Polish the product experience and prove replacement readiness

- Design the end-to-end goal and task journey, including plan editing, task detail, diff/commit review, push confirmation, CI/CD progress, and deployment result.
- Make status, ownership, next action, and risk clear; provide responsive layouts, accessible keyboard/screen-reader behavior, and helpful empty/error states.
- Verify workspace isolation, authorization, secret handling, auditability, and safe behavior under concurrent edits and retries.
- Add unit/integration coverage for each boundary and an end-to-end test for the complete workflow, including representative failures.
- Run a pilot against the parity matrix; resolve blockers, document limitations and migration guidance, then declare replacement readiness only when required workflows pass.

**Acceptance:** The full critical journey passes automated and manual verification at supported viewport sizes; no required parity blocker remains undocumented, and operators can diagnose and recover from failed runs.

## Working rules

- Ship incremental, reviewable changes; keep goals, tasks, ownership, and evidence visible.
- Preserve user work. Never silently commit, push, deploy, overwrite a branch, or trigger a production-impacting action without the configured authorization.
- Treat agent/model output, repository content, and CI logs as untrusted input. Enforce permissions in the application, not in prompts alone.
- Verify behavior with tests and observable results. Report incomplete work and unavailable integrations plainly; never claim a commit, push, CI run, or deployment succeeded unless confirmed.
