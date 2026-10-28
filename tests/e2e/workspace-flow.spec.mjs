import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

const agentId = process.env.AUTH_AGENT_ID;
const agentKey = process.env.AUTH_AGENT_KEY;

test.describe("authenticated workspace flow", () => {
  test.skip(!agentId || !agentKey, "AUTH_AGENT_ID and AUTH_AGENT_KEY are required for this production E2E test");

  test("signs in, creates a workspace, and exercises its goal task board", async ({ page }, testInfo) => {
    testInfo.setTimeout(150_000);
    const workspaceName = `pwe2e${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    let workspaceCreated = false;

    async function screenshot(name) {
      await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
    }

    try {
      await page.route("**/models", (route) =>
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify([
            { id: "gpt-4o-mini", default: true },
            { id: "gemini/gemini-2.5-flash", name: "gemini-2.5-flash", provider: "gemini" },
            { id: "ollama:lg/qwen3:14b", name: "qwen3:14b", provider: "ollama", serverName: "LG" },
          ]),
        }),
      );
      await page.goto("/", { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(/auth\.api\.apphor\.de\/login/);
      await page.getByText("Sign in as an Agent", { exact: true }).click();
      await page.locator("#agent-id").fill(agentId);
      await page.locator("#agent-token").fill(agentKey);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(/agents\.lab\.apphor\.de\/(?:#.*)?$/);
      await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
      await page.setViewportSize({ width: 1280, height: 900 });
      const sidebar = page.locator("aside");
      await expect(sidebar.getByRole("button", { name: "Sign out" })).toBeVisible();
      await expect(sidebar.getByRole("button", { name: /Create workspace/ })).toBeVisible();
      await expect(sidebar.getByText("Sessions", { exact: true })).toHaveCount(0);
      const currentTeam = await page.evaluate(async () =>
        (await fetch("/teams/current", { credentials: "same-origin" })).json(),
      );
      if (!currentTeam.id) {
        await page.setViewportSize({ width: 390, height: 844 });
        await page
          .getByRole("navigation", { name: "Primary navigation" })
          .getByRole("button", { name: "Integrations" })
          .click();
        const teamCreated = page.waitForResponse(
          (response) => response.request().method() === "POST" && response.url().endsWith("/teams"),
        );
        page.once("dialog", (dialog) => dialog.accept("Age team"));
        await page.getByRole("button", { name: "Create team" }).click();
        expect((await teamCreated).status()).toBe(201);
        await page.reload({ waitUntil: "networkidle" });
        await page.setViewportSize({ width: 390, height: 844 });
        await page
          .getByRole("navigation", { name: "Primary navigation" })
          .getByRole("button", { name: "Workspaces" })
          .click();
        await page.setViewportSize({ width: 1280, height: 900 });
      }
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
      let plannerMessage;
      const plannerMessageRoute = `**/workspaces/${workspaceName}/history/*/message`;
      await page.route(plannerMessageRoute, async (route) => {
        plannerMessage = JSON.parse(route.request().postData() || "{}");
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ role: "user", content: plannerMessage.message, meta: { uid: "planner-test" } }),
        });
      });
      const plannerSession = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" && response.url().endsWith(`/workspaces/${workspaceName}/history`),
      );
      await page.getByRole("button", { name: "Start planning with AI" }).click();
      expect((await plannerSession).status()).toBe(201);
      expect(plannerMessage.message).toContain("Finish, review, and verify the workspace features.");
      await expect(page.getByText("Working on a response…", { exact: true })).toBeVisible();
      await page.unroute(plannerMessageRoute);
      await page.locator("aside").getByRole("button", { name: workspaceName }).click();
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
      await screenshot("04-task-details-modal");
      await taskDialog.getByRole("button", { name: "Close" }).click();
      await screenshot("05-goal-task-board");
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByRole("heading", { name: "Ship workspace flow" })).toBeVisible();
      await page.locator('[data-task-column="done"]').getByRole("button", { name: "Verify the flow" }).click();
      await screenshot("06-task-details-modal-mobile");
      await taskDialog.getByRole("button", { name: "Close" }).click();
      await screenshot("07-goal-task-board-mobile");
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
      const modelPicker = page.getByRole("dialog", { name: "Choose a model" });
      const modelTrigger = page.getByRole("button", { name: "Model" });
      await modelTrigger.click();
      await expect(modelPicker.getByRole("group", { name: "gemini" })).toBeVisible();
      await expect(modelPicker.getByRole("group", { name: "LG" })).toBeVisible();
      await expect(modelPicker.getByText("undefined", { exact: true })).toHaveCount(0);
      await modelPicker.getByRole("button", { name: "Manage models and providers" }).click();
      const settingsDialog = page.locator("dialog[data-model-settings]");
      await expect(settingsDialog.getByRole("heading", { name: "Models and providers" })).toBeVisible();
      await settingsDialog.getByRole("checkbox", { name: /ollama.*models/ }).uncheck();
      await settingsDialog.getByRole("checkbox", { name: /qwen3:14b/ }).uncheck();
      await expect
        .poll(() => page.evaluate(() => JSON.parse(window.localStorage.getItem("age-model-picker-preferences"))))
        .toMatchObject({ providers: { ollama: false }, models: { "ollama:lg/qwen3:14b": false } });
      await settingsDialog.getByRole("button", { name: "Close model settings" }).click();
      await modelTrigger.click();
      await modelPicker.getByRole("searchbox", { name: "Search models" }).fill("qwen3");
      await expect(modelPicker.getByRole("option", { name: "qwen3:14b" })).toHaveCount(0);
      await modelPicker.getByRole("button", { name: "Manage models and providers" }).click();
      await settingsDialog.getByRole("checkbox", { name: /ollama.*models/ }).check();
      await settingsDialog.getByRole("checkbox", { name: /qwen3:14b/ }).check();
      await settingsDialog.getByRole("button", { name: "Close model settings" }).click();
      await modelTrigger.click();
      const modelSearch = modelPicker.getByRole("searchbox", { name: "Search models" });
      await modelSearch.fill("qwen3");
      await expect(modelPicker.getByRole("option", { name: "qwen3:14b" })).toBeVisible();
      await expect(modelPicker.getByRole("option", { name: "gemini-2.5-flash" })).toHaveCount(0);
      await modelPicker.getByRole("option", { name: "qwen3:14b" }).click();
      await expect(modelTrigger).toHaveText("qwen3:14b · LG");
      await expect(modelPicker).toBeHidden();
      await screenshot("08-session-created");
      expect(session.id).toBeTruthy();
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
