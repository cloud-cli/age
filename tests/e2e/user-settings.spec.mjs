import { expect, test } from "@playwright/test";

const models = [
  { id: "gemini/gemini-2.5-flash", name: "gemini-2.5-flash", provider: "gemini" },
  { id: "ollama:lg/qwen3:14b", name: "qwen3:14b", provider: "ollama", serverName: "LG" },
];

test("user settings show account, provider management, and API models separately from workspace settings", async ({
  page,
}) => {
  let modelsAvailable = false;
  let workspaceName = "";
  let gitminiRepo = "";
  page.on("console", (message) => console.log("browser", message.type(), message.text()));
  page.on("pageerror", (error) => console.log("page error", error.stack));
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "age-model-picker-preferences",
      JSON.stringify({ providers: { gemini: false, ollama: false }, models: {} }),
    );
  });
  await page.route("**/api/me", (route) => {
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ name: "Test User", email: "test@example.com" }),
    });
  });
  await page.route("https://127.0.0.1:4174/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    let body = [];
    if (pathname === "/models") {
      body = { models: modelsAvailable ? models : [] };
    } else if (pathname === "/teams/current") {
      body = { id: "", role: "", members: [] };
    } else if (pathname === "/workspaces" && route.request().method() === "POST") {
      workspaceName = route.request().postDataJSON().name;
      body = { name: workspaceName };
    } else if (pathname === "/workspaces") {
      body = workspaceName ? [{ name: workspaceName }] : [];
    } else if (pathname.endsWith("/settings") && pathname.startsWith("/workspaces/")) {
      body = {
        name: workspaceName,
        description: "",
        summary: "",
        goals: [],
        revision: 0,
        ...(gitminiRepo ? { gitmini: { org: "test-org", repo: gitminiRepo } } : {}),
      };
    } else if (pathname.endsWith("/tasks") && pathname.startsWith("/workspaces/")) {
      body = [];
    } else if (pathname.endsWith("/gitmini") && route.request().method() === "POST") {
      gitminiRepo = route.request().postDataJSON().repo;
      body = { org: "test-org", repo: gitminiRepo, remote: "gitmini", ready: true };
    } else if (pathname === "/connectors") {
      body = [{ provider: "gitmini", configured: true, org: "test-org" }];
    } else if (pathname === "/connectors/gitmini" && route.request().method() === "PUT") {
      body = { configured: true, org: "test-org" };
    } else if (pathname === "/connectors/gemini/models") {
      modelsAvailable = true;
      body = { models };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.goto("/");
  await page.setViewportSize({ width: 1280, height: 900 });
  const sidebar = page.locator("aside");
  await expect(sidebar.getByRole("button", { name: "Open Settings" })).toBeVisible();
  expect(await sidebar.evaluate((node) => window.getComputedStyle(node).borderRightWidth)).toBe("0px");
  await sidebar.getByRole("button", { name: "Open Settings" }).click();

  const settings = page.locator("[data-user-settings-main]");
  await expect(settings.getByRole("heading", { name: "Account and models" })).toBeVisible();
  await expect(settings).toContainText("Test User");
  const gitminiForm = page
    .locator("[data-connectors-page] form")
    .filter({ has: page.locator("[data-gitmini-status]") });
  await expect(page.locator("[data-gitmini-status]")).toContainText("test-org");
  await gitminiForm.getByLabel("Organization").fill("test-org");
  await gitminiForm.getByLabel("GitMini PAT").fill(`gmpat_${"x".repeat(43)}`);
  await gitminiForm.getByRole("button", { name: "Connect / replace" }).click();
  await expect(page.locator("[data-gitmini-status]")).toContainText("Connected to test-org");
  await expect(settings.locator("[data-user-model-empty]")).toBeVisible();
  const modelReload = page.waitForResponse((response) => new URL(response.url()).pathname === "/models");
  await settings.locator('[data-provider-form="gemini"]').getByRole("button", { name: "Test connection" }).click();
  await modelReload;
  await expect(settings.locator("[data-user-model-groups]")).toContainText("gemini-2.5-flash");
  await expect(settings.locator("[data-user-model-groups]")).toContainText("qwen3:14b");
  await expect(settings.locator("[data-user-model-groups] input[type=checkbox]").first()).not.toBeChecked();
  const geminiGroup = settings.locator("[data-user-model-groups] section").filter({ hasText: "gemini-2.5-flash" });
  const geminiCheckboxes = geminiGroup.locator('input[type="checkbox"]');
  await expect(geminiCheckboxes.nth(1)).not.toBeChecked();
  await expect(geminiCheckboxes.nth(1)).toBeEnabled();
  await geminiCheckboxes.nth(1).check();
  await expect(geminiCheckboxes.first()).toBeChecked();
  await geminiCheckboxes.nth(1).uncheck();
  await expect(geminiCheckboxes.first()).not.toBeChecked();
  await settings.getByRole("button", { name: "Show all models" }).click();
  await expect(settings.locator("[data-user-model-groups] input[type=checkbox]").first()).toBeChecked();
  await expect(settings.locator('[data-provider-form="gemini"]')).toBeVisible();
  await expect(page.locator("[data-settings-main]")).toBeHidden();
  await page.screenshot({ path: "test-results/user-settings-page.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(settings.getByRole("heading", { name: "Account and models" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  await gitminiForm.scrollIntoViewIfNeeded();
  await expect(page.locator("[data-gitmini-status]")).toBeInViewport();
  await page.screenshot({ path: "test-results/gitmini-integrations-mobile.png" });

  await page.goto("/#/settings");
  await expect(page.locator("[data-settings-main]")).toBeVisible();
  await expect(page.locator("[data-settings-main]")).toContainText("WORKSPACE SETTINGS");
  await expect(page.locator("[data-user-settings-main]")).toBeHidden();

  await page.goto("/#/chat");
  const modelPicker = page.getByRole("dialog", { name: "Choose a model" });
  await page.evaluate(() =>
    window.localStorage.setItem(
      "age-model-picker-preferences",
      JSON.stringify({ providers: { gemini: false, ollama: false }, models: {} }),
    ),
  );
  await page.getByRole("button", { name: "Model" }).click();
  await expect(modelPicker).toContainText("No models match the current search or filters.");
  await modelPicker.getByRole("button", { name: "Show all available models" }).click();
  await expect(modelPicker.getByRole("option", { name: "qwen3:14b" })).toBeVisible();
  await modelPicker.getByRole("searchbox", { name: "Search models" }).fill("gemini");
  await expect(modelPicker.getByRole("option", { name: "gemini-2.5-flash" })).toBeVisible();
  await expect(modelPicker.getByRole("option", { name: "qwen3:14b" })).toHaveCount(0);
  await modelPicker.getByRole("searchbox", { name: "Search models" }).fill("qwen3");
  await modelPicker.getByRole("option", { name: "qwen3:14b" }).click();
  await expect(page.getByRole("button", { name: "Model" })).toHaveText("qwen3:14b · LG");

  await page.setViewportSize({ width: 1280, height: 900 });
  page.once("dialog", (dialog) => dialog.accept("repo-default"));
  await sidebar
    .getByRole("button", { name: /Create workspace/ })
    .first()
    .click();
  await expect(page.locator("[data-overview-main]")).toBeVisible();
  await page.getByRole("button", { name: "Workspace settings" }).click();
  await expect(page.locator("[data-gitmini-repo]")).toHaveValue("repo-default");
  const linkRequest = page.waitForRequest(
    (request) => request.method() === "POST" && new URL(request.url()).pathname === "/workspaces/repo-default/gitmini",
  );
  await page.getByRole("button", { name: "Create / link" }).click();
  const request = await linkRequest;
  expect(request.postDataJSON()).toEqual({ repo: "repo-default" });
  await expect(page.locator("[data-workspace-gitmini-status]")).toContainText("Remote ready");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator("[data-workspace-gitmini-status]")).toContainText("Linked to test-org/repo-default");
  await page.locator("[data-gitmini-workspace-link]").scrollIntoViewIfNeeded();
  await expect(page.locator("[data-gitmini-workspace-link]")).toBeInViewport();
  await page.screenshot({ path: "test-results/gitmini-workspace-mobile.png" });
});
