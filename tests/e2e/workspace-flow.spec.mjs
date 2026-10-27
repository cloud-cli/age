import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

const agentId = process.env.AUTH_AGENT_ID;
const agentKey = process.env.AUTH_AGENT_KEY;

test.describe("authenticated workspace flow", () => {
  test.skip(!agentId || !agentKey, "AUTH_AGENT_ID and AUTH_AGENT_KEY are required for this production E2E test");

  test("signs in, creates a workspace and session, and receives an agent reply", async ({ page }, testInfo) => {
    testInfo.setTimeout(150_000);
    const workspaceName = `pwe2e${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    let workspaceCreated = false;

    async function screenshot(name) {
      await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
    }

    try {
      await page.goto("/", { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(/auth\.api\.apphor\.de\/login/);
      await page.getByText("Sign in as an Agent", { exact: true }).click();
      await page.locator("#agent-id").fill(agentId);
      await page.locator("#agent-token").fill(agentKey);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(/agents\.lab\.apphor\.de\/?$/);
      await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
      await page.setViewportSize({ width: 1280, height: 900 });
      const sidebar = page.locator("aside");
      await expect(sidebar.getByRole("button", { name: "Sign out" })).toBeVisible();
      await expect(sidebar.getByRole("button", { name: /Create workspace/ })).toBeVisible();
      await expect(sidebar.getByText("Sessions", { exact: true })).toHaveCount(0);
      await screenshot("01-signed-in");

      await page.evaluate(async () => {
        const workspaces = await (await fetch("/workspaces", { credentials: "same-origin" })).json();
        await Promise.all(
          workspaces
            .filter((workspace) => workspace.name.startsWith("pwe2e"))
            .map((workspace) =>
              fetch(`/workspaces/${workspace.name}`, { method: "DELETE", credentials: "same-origin" }),
            ),
        );
      });

      const workspaceResponse = page.waitForResponse(
        (response) => response.request().method() === "POST" && response.url().endsWith("/workspaces"),
      );
      page.once("dialog", (dialog) => dialog.accept(workspaceName));
      await page
        .getByRole("button", { name: /Create a workspace/ })
        .first()
        .click();
      workspaceCreated = true;
      const created = await (await workspaceResponse).json();
      expect(created.name).toBe(workspaceName);

      await page.reload({ waitUntil: "networkidle" });
      await page.setViewportSize({ width: 390, height: 844 });
      await page
        .getByRole("navigation", { name: "Primary navigation" })
        .getByRole("button", { name: "Workspaces" })
        .click();
      const workspace = page.locator("[data-workspaces-main]").getByRole("button", { name: new RegExp(workspaceName) });
      await expect(workspace).toBeVisible();
      await screenshot("02-workspace-created-and-refreshed");
      await workspace.click();
      await screenshot("03-workspace-refreshed-and-selected");
      await expect(page.getByRole("heading", { name: workspaceName })).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`#/overview\\?workspace=${encodeURIComponent(workspaceName)}`));
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.reload({ waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { name: workspaceName })).toBeVisible();

      await page.getByRole("button", { name: /Add goal/ }).click();
      const goalDialog = page.locator("dialog[data-goal-dialog]");
      await goalDialog.getByLabel("Title").fill("Ship the workspace flow");
      await goalDialog.getByLabel("Description").fill("Finish and verify the workspace features.");
      await goalDialog.getByRole("button", { name: "Save goal" }).click();
      const goalCard = page.locator("[data-goals-list] article").filter({ hasText: "Ship the workspace flow" });
      await expect(goalCard).toBeVisible({ timeout: 5_000 });
      await goalCard.getByRole("button", { name: "Edit" }).click();
      await goalDialog.getByLabel("Title").fill("Ship workspace flow");
      await goalDialog.getByLabel("Description").fill("Finish, review, and verify the workspace features.");
      await goalDialog.getByRole("button", { name: "Save goal" }).click();
      await page
        .locator("[data-goals-list] article")
        .filter({ hasText: "Ship workspace flow" })
        .getByRole("button", { name: /Ship workspace flow/ })
        .click();
      await expect(page.getByRole("heading", { name: "Ship workspace flow" })).toBeVisible();
      await expect(page).toHaveURL(/#\/goal\?workspace=.*&goal=/);
      await page.reload({ waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { name: "Ship workspace flow" })).toBeVisible();

      const taskPrompts = ["Verify the flow", "Exercise status and comments."];
      let promptIndex = 0;
      const acceptTaskPrompts = (dialog) => dialog.accept(taskPrompts[promptIndex++]);
      page.on("dialog", acceptTaskPrompts);
      await page.getByRole("button", { name: /Add task/ }).click();
      page.off("dialog", acceptTaskPrompts);
      const taskCard = page.getByRole("button", { name: "Verify the flow" });
      await expect(taskCard).toBeVisible();
      await taskCard.click();
      const taskDialog = page.locator("dialog[data-task-dialog]");
      await expect(taskDialog.getByText("Exercise status and comments.")).toBeVisible();
      await taskDialog.locator("[data-task-status]").selectOption("in-progress");
      await taskDialog.locator("[data-task-status]").selectOption("done");
      await taskDialog.getByRole("textbox", { name: "Add a comment" }).fill("Looks good.");
      await taskDialog.getByRole("button", { name: "Send" }).click();
      await expect(taskDialog.getByText("Looks good.")).toBeVisible();
      await expect(
        page.locator('[data-task-column="done"]').getByRole("button", { name: "Verify the flow" }),
      ).toBeVisible();
      await taskDialog.getByRole("button", { name: "Close" }).click();
      await screenshot("04-goal-task-board");
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByRole("heading", { name: "Ship workspace flow" })).toBeVisible();
      await screenshot("05-goal-task-board-mobile");
      await page.getByRole("button", { name: "← Workspace settings" }).click();
      const editedGoal = page.locator("[data-goals-list] article").filter({ hasText: "Ship workspace flow" });
      page.once("dialog", (dialog) => dialog.accept());
      await editedGoal.getByRole("button", { name: "Remove" }).click();
      await expect(page.locator("[data-goals-empty]")).toBeVisible();

      const sessionResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" && response.url().endsWith(`/workspaces/${workspaceName}/history`),
      );
      await page
        .getByRole("navigation", { name: "Primary navigation" })
        .getByRole("button", { name: "Sessions" })
        .click();
      await page.getByRole("button", { name: "New chat" }).click();
      const session = await (await sessionResponse).json();
      await expect(page.getByRole("textbox", { name: "Message draft" })).toBeEnabled();
      await screenshot("06-session-created");

      const prompt = "Reply with exactly: E2E workspace flow complete.";
      await page.getByRole("textbox", { name: "Message draft" }).fill(prompt);
      await page.getByRole("button", { name: "Send message" }).click();
      await expect(page.getByText(prompt, { exact: true })).toBeVisible();

      await expect
        .poll(
          async () =>
            page.evaluate(
              async ({ workspace, sessionId }) => {
                const response = await fetch(`/workspaces/${workspace}/history/${sessionId}`, {
                  credentials: "same-origin",
                });
                if (!response.ok) {
                  return false;
                }
                const history = await response.json();
                return history.messages.some(
                  (message) => message.role === "assistant" && message.content && !message.tool_calls?.length,
                );
              },
              { workspace: workspaceName, sessionId: session.id },
            ),
          { timeout: 90_000, intervals: [1_000, 2_000, 3_000] },
        )
        .toBe(true);
      await expect(page.getByText("E2E workspace flow complete.", { exact: true })).toBeVisible({ timeout: 15_000 });
      await screenshot("07-agent-completed");
    } finally {
      if (workspaceCreated) {
        await page
          .evaluate(async (workspace) => {
            await fetch(`/workspaces/${workspace}`, {
              method: "DELETE",
              credentials: "same-origin",
              signal: globalThis.AbortSignal.timeout(5_000),
            });
          }, workspaceName)
          .catch(() => {});
      }
      await page
        .evaluate(async () => {
          await fetch("/auth/logout", {
            method: "POST",
            credentials: "same-origin",
            signal: globalThis.AbortSignal.timeout(5_000),
          });
        })
        .catch(() => {});
    }
  });
});
