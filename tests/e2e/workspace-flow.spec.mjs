import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

const agentId = process.env.AUTH_AGENT_ID;
const agentKey = process.env.AUTH_AGENT_KEY;

test.describe("authenticated workspace flow", () => {
  test.skip(!agentId || !agentKey, "AUTH_AGENT_ID and AUTH_AGENT_KEY are required for this production E2E test");

  test("signs in, creates a workspace and session, and receives an agent reply", async ({ page }, testInfo) => {
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
      await page.getByRole("button", { name: "Create workspace" }).click();
      workspaceCreated = true;
      const created = await (await workspaceResponse).json();
      expect(created.name).toBe(workspaceName);

      await page.reload({ waitUntil: "networkidle" });
      const project = page.locator('nav[aria-label="Projects"]').getByRole("button", { name: workspaceName });
      await expect(project).toBeVisible();
      await screenshot("02-workspace-created-and-refreshed");
      await project.click();
      await screenshot("03-workspace-refreshed-and-selected");

      const sessionResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" && response.url().endsWith(`/workspaces/${workspaceName}/history`),
      );
      await page.getByRole("button", { name: "Create session" }).click();
      const session = await (await sessionResponse).json();
      await expect(page.getByRole("textbox", { name: "Message draft" })).toBeEnabled();
      await screenshot("04-session-created");

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
                if (!response.ok) return false;
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
      await screenshot("05-agent-completed");
    } finally {
      if (workspaceCreated) {
        await page.evaluate(async (workspace) => {
          await fetch(`/workspaces/${workspace}`, { method: "DELETE", credentials: "same-origin" });
        }, workspaceName);
      }
      await page
        .getByRole("button", { name: "Sign out" })
        .click()
        .catch(() => {});
    }
  });
});
