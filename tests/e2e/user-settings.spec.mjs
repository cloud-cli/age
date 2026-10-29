import { expect, test } from "@playwright/test";

const models = [
  { id: "gemini/gemini-2.5-flash", name: "gemini-2.5-flash", provider: "gemini" },
  { id: "openai/gpt-4o-mini", name: "gpt-4o-mini", provider: "openai" },
  { id: "chatgpt/gpt-5", name: "gpt-5", provider: "chatgpt" },
  { id: "ollama:lg/qwen3:14b", name: "qwen3:14b", provider: "ollama", serverName: "Home Server" },
  { id: "ollama:cloud/llama3", name: "llama3", provider: "ollama", serverName: "Cloud" },
];

test("provider model filters live in connection cards and workspace onboarding requires goals", async ({ page }) => {
  let modelsAvailable = false;
  let newOllamaModelAvailable = false;
  let newOllamaSaved = false;
  let workspaceName = "";
  let goalList = [];
  let populatedOverview = false;
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
      body = {
        models: modelsAvailable
          ? [
              ...models,
              ...(newOllamaModelAvailable
                ? [
                    {
                      id: "ollama:new-connector/new-model",
                      name: "new-model",
                      provider: "ollama",
                      serverName: "New Server",
                    },
                  ]
                : []),
            ]
          : [],
      };
    } else if (pathname === "/teams/current") {
      body = { id: "", role: "", members: [] };
    } else if (pathname === "/workspaces" && route.request().method() === "POST") {
      workspaceName = route.request().postDataJSON().name;
      body = { name: workspaceName };
    } else if (pathname === "/workspaces") {
      body = workspaceName ? [{ name: workspaceName }] : [];
    } else if (pathname.endsWith("/settings") && route.request().method() === "PUT") {
      goalList = route.request().postDataJSON().goals || goalList;
      body = { name: workspaceName, goals: goalList, revision: 1 };
    } else if (pathname.endsWith("/settings") && pathname.startsWith("/workspaces/")) {
      body = {
        name: workspaceName,
        description: "",
        summary: "",
        goals: goalList,
        revision: 0,
        ...(gitminiRepo ? { gitmini: { org: "test-org", repo: gitminiRepo } } : {}),
      };
    } else if (pathname.endsWith("/tasks") && pathname.startsWith("/workspaces/")) {
      body = populatedOverview ? [{ id: "task-1", title: "First task", status: "todo" }] : [];
    } else if (pathname.endsWith("/history") && route.request().method() === "POST") {
      body = { id: "planner-session", title: "Planner" };
    } else if (pathname.endsWith("/history") && pathname.startsWith("/workspaces/")) {
      body = populatedOverview ? [{ id: "session-1", title: "Planning session", updatedAt: 1 }] : [];
    } else if (pathname.endsWith("/gitmini") && route.request().method() === "POST") {
      gitminiRepo = route.request().postDataJSON().repo;
      body = { org: "test-org", repo: gitminiRepo, remote: "gitmini", ready: true };
    } else if (pathname === "/connectors" && route.request().method() === "PUT") {
      const connector = route.request().postDataJSON();
      if (connector.provider === "ollama") {
        newOllamaSaved = true;
      }
      body = { ...connector, id: connector.provider === "ollama" ? "new-connector" : "connector-id", configured: true };
    } else if (pathname === "/connectors") {
      body = [
        { id: "lg", provider: "ollama", configured: true, name: "Home Server", url: "https://home.example" },
        { id: "cloud", provider: "ollama", configured: true, name: "Cloud", url: "https://cloud.example" },
        ...(newOllamaSaved
          ? [
              {
                id: "new-connector",
                provider: "ollama",
                configured: true,
                name: "New Server",
                url: "https://new-server.example",
              },
            ]
          : []),
        { provider: "gitmini", configured: true, org: "test-org" },
      ];
    } else if (pathname === "/connectors/gitmini" && route.request().method() === "PUT") {
      body = { configured: true, org: "test-org" };
    } else if (pathname === "/connectors/gemini/models") {
      modelsAvailable = true;
      body = { models };
    } else if (pathname === "/connectors/ollama/new-connector/models") {
      newOllamaModelAvailable = true;
      body = { models: [{ id: "new-model", name: "new-model" }] };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.goto("/");
  await page.setViewportSize({ width: 1280, height: 900 });
  const sidebar = page.locator("aside");
  await expect(sidebar.getByRole("button", { name: "Open Settings" })).toBeVisible();
  expect(await sidebar.evaluate((node) => window.getComputedStyle(node).borderRightWidth)).toBe("0px");
  const connectorsLoaded = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/connectors" && response.request().method() === "GET",
  );
  await sidebar.getByRole("button", { name: "Open Settings" }).click();
  await connectorsLoaded;

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
  const modelReload = page.waitForResponse((response) => new URL(response.url()).pathname === "/models");
  await settings.locator('[data-provider-form="gemini"]').getByRole("button", { name: "Test connection" }).click();
  await modelReload;
  const providers = page.locator("[data-connectors-page]");
  const geminiModels = providers.locator('[data-provider-form="gemini"] [data-model-preferences="gemini"]');
  const openAiModels = providers.locator('[data-provider-form="openai"] [data-model-preferences="openai"]');
  const chatgptModels = providers.locator('section:has([data-chatgpt-connect]) [data-model-preferences="chatgpt"]');
  await expect(geminiModels).toContainText("gemini-2.5-flash");
  await expect(openAiModels).toContainText("gpt-4o-mini");
  await expect(chatgptModels).toContainText("gpt-5");
  await expect(
    providers.locator('[data-provider-form="ollama"][data-connector-id="lg"] [data-model-preferences="ollama:lg"]'),
  ).toContainText("qwen3:14b");
  await expect(
    providers.locator(
      '[data-provider-form="ollama"][data-connector-id="cloud"] [data-model-preferences="ollama:cloud"]',
    ),
  ).toContainText("llama3");
  await expect(geminiModels).toContainText("Models shown in chat");
  await expect(providers.locator("[data-user-model-groups]")).toHaveCount(0);
  await expect(settings.getByRole("heading", { name: "Providers and model filters" })).toHaveCount(0);
  const geminiCheckbox = geminiModels.locator('input[type="checkbox"]');
  await expect(geminiCheckbox).not.toBeChecked();
  await geminiCheckbox.check();
  await expect(geminiModels.locator('input[type="checkbox"]')).toBeChecked();
  await providers.getByRole("button", { name: "Show all models" }).click();
  await expect(geminiModels.locator('input[type="checkbox"]')).toBeChecked();
  await expect(settings.locator('[data-provider-form="gemini"]')).toBeVisible();
  await expect(providers.locator('[data-provider-form="gemini"] button[type="submit"]')).toHaveCSS(
    "color",
    "rgb(255, 255, 255)",
  );
  await expect(providers.getByRole("button", { name: "Connect ChatGPT" })).toHaveCSS("color", "rgb(255, 255, 255)");
  await page.setViewportSize({ width: 390, height: 844 });
  await providers.getByRole("button", { name: "Add server" }).click();
  const newServerDraftForm = providers.locator("[data-ollama-servers] form").last();
  await newServerDraftForm.locator('input[name="name"]').fill("New Server");
  await newServerDraftForm.locator('input[name="url"]').fill("https://new-server.example");
  await newServerDraftForm.getByRole("button", { name: "Save server" }).click();
  const newServerForm = providers.locator('[data-ollama-servers] form[data-connector-id="new-connector"]');
  await expect(newServerForm).toHaveAttribute("data-connector-id", "new-connector");
  await expect(newServerForm.getByRole("button", { name: "Save server" })).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(newServerForm.locator('[data-model-preferences="ollama:new-connector"]')).toContainText(
    "No models loaded",
  );
  const newModelReload = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/models" && response.request().method() === "GET",
  );
  await newServerForm.getByRole("button", { name: "Test connection" }).click();
  await newModelReload;
  await expect(newServerForm.locator('[data-model-preferences="ollama:new-connector"]')).toContainText("new-model");
  await expect(
    newServerForm.locator('[data-model-preferences="ollama:new-connector"] input[type="checkbox"]'),
  ).toBeVisible();
  const newModelCheckbox = newServerForm.locator(
    '[data-model-preferences="ollama:new-connector"] input[type="checkbox"]',
  );
  await newModelCheckbox.uncheck();
  await expect(newModelCheckbox).toBeFocused();
  await newModelCheckbox.scrollIntoViewIfNeeded();
  await expect(
    newServerForm.locator('[data-model-preferences="ollama:new-connector"] input[type="checkbox"]'),
  ).toBeInViewport();
  await page.screenshot({ path: "test-results/provider-models-mobile.png" });
  await page.setViewportSize({ width: 1280, height: 900 });
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
  await expect(page.getByRole("button", { name: "Send message" })).toHaveCSS("color", "rgb(255, 255, 255)");
  await page.evaluate(() =>
    window.localStorage.setItem(
      "age-model-picker-preferences",
      JSON.stringify({ providers: { gemini: false, ollama: false }, models: {} }),
    ),
  );
  await page.getByRole("button", { name: "Model" }).click();
  await expect(modelPicker).toContainText("No models match the current search or filters.");
  await page.locator('[aria-label="Model"]').click();
  await page.evaluate(() =>
    window.localStorage.setItem(
      "age-model-picker-preferences",
      JSON.stringify({ providers: { ollama: false, "ollama:lg": true, gemini: false }, models: {} }),
    ),
  );
  await page.getByRole("button", { name: "Model", exact: true }).click();
  await expect(modelPicker.getByRole("option", { name: "qwen3:14b" })).toBeVisible();
  await expect(modelPicker.getByRole("option", { name: "llama3" })).toHaveCount(0);
  await page.locator('[aria-label="Model"]').click();
  await page.evaluate(() =>
    window.localStorage.setItem("age-model-picker-preferences", JSON.stringify({ providers: {}, models: {} })),
  );
  await page.getByRole("button", { name: "Model", exact: true }).click();
  await expect(modelPicker.getByRole("option", { name: "qwen3:14b" })).toBeVisible();
  await modelPicker.getByRole("searchbox", { name: "Search models" }).fill("gemini");
  await expect(modelPicker.getByRole("option", { name: "gemini-2.5-flash" })).toBeVisible();
  await expect(modelPicker.getByRole("option", { name: "qwen3:14b" })).toHaveCount(0);
  await modelPicker.getByRole("searchbox", { name: "Search models" }).fill("qwen3");
  await modelPicker.getByRole("option", { name: "qwen3:14b" }).click();
  await expect(page.getByRole("button", { name: "Model" })).toHaveText("qwen3:14b · Home Server");

  await page.setViewportSize({ width: 1280, height: 900 });
  page.once("dialog", (dialog) => dialog.accept("repo-default"));
  await sidebar
    .getByRole("button", { name: /Create workspace/ })
    .first()
    .click();
  await expect(page.locator("[data-overview-main]")).toBeVisible();
  await expect(page.locator("[data-overview-recent]")).toBeHidden();
  await expect(page.locator("[data-overview-tasks]")).toBeHidden();
  await expect(page.getByText("WORKSPACE HOME", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Define your first goal" })).toBeVisible();
  const plannerPosts = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /history|messages/.test(new URL(request.url()).pathname)) {
      plannerPosts.push(new URL(request.url()).pathname);
    }
  });
  await page.goto(`/#/chat?workspace=${encodeURIComponent(workspaceName)}`);
  const defineGoalButton = page.getByRole("button", { name: "Define your first goal" });
  await expect(defineGoalButton).toBeVisible();
  await expect(defineGoalButton).toHaveCSS("color", "rgb(255, 255, 255)");
  await defineGoalButton.click();
  await expect(page.locator("[data-overview-main]")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Define your first goal" })).toBeVisible();
  expect(plannerPosts).toEqual([]);

  await page.goto(`/#/sessions?workspace=${encodeURIComponent(workspaceName)}`);
  await page.getByRole("button", { name: "Start planning" }).click();
  const goalDialog = page.locator("[data-goal-dialog]");
  await expect(goalDialog).toBeVisible();
  await expect.poll(() => plannerPosts).toEqual([]);
  await goalDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(goalDialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Add your first goal" })).toBeVisible();
  await page.getByRole("button", { name: "Add your first goal" }).click();
  await expect(goalDialog).toBeVisible();
  await expect.poll(() => plannerPosts).toEqual([]);
  await goalDialog.getByLabel("Title").fill("Ship the feature");
  await goalDialog.getByRole("button", { name: "Save goal" }).click();
  await expect(page.getByRole("button", { name: "Start planning with AI" })).toBeVisible();
  await expect.poll(() => plannerPosts).toEqual([]);
  populatedOverview = true;
  await page.reload();
  await expect(page.locator("[data-overview-recent]")).toBeVisible();
  await expect(page.locator("[data-overview-recent]")).toContainText("Planning session");
  await expect(page.locator("[data-overview-tasks]")).toBeVisible();
  await expect(page.locator("[data-overview-tasks]")).toContainText("First task");
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
