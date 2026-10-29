import { expect, test } from "@playwright/test";

test("mobile workspace drawer supports keyboard, backdrop, selection, and desktop breakpoint", async ({
  page,
}, testInfo) => {
  page.on("console", (message) => console.log("browser", message.type(), message.text()));
  page.on("pageerror", (error) => console.log("page error", error.stack));
  await page.route("**/api/me", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ name: "Test User", email: "test@example.com" }),
    }),
  );
  const workspaces = [{ name: "Alpha" }, { name: "Beta" }];
  await page.route("**/workspaces**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname !== "/workspaces" && !pathname.startsWith("/workspaces/")) {
      await route.continue();
      return;
    }
    if (pathname === "/workspaces" && route.request().method() === "POST") {
      const workspace = JSON.parse(route.request().postData() || "{}");
      workspaces.push(workspace);
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(workspace) });
      return;
    }
    const body = pathname === "/workspaces" ? workspaces : [];
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/models", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/connectors", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/teams/current", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "", role: "", members: [] }) }),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/overview?workspace=Alpha");
  const toggle = page.getByRole("button", { name: "Open workspace menu" });
  const drawer = page.getByRole("dialog", { name: "Workspaces" });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(drawer).toBeVisible();
  await page.locator("[data-drawer-panel]").evaluate(async (panel) => {
    await Promise.all(panel.getAnimations().map((animation) => animation.finished));
  });
  await page.screenshot({ path: testInfo.outputPath("mobile-drawer-open.png") });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page).toHaveURL(/#\/overview\?workspace=Alpha$/);
  await page.keyboard.press("Shift+Tab");
  await expect(drawer.getByRole("button", { name: "Open Settings" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(drawer.locator("[data-close-mobile-drawer]")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();

  await toggle.click();
  await page.mouse.click(380, 420);
  await expect(drawer).toBeHidden();
  await toggle.click();
  await expect(drawer.getByRole("button", { name: "Alpha" })).toBeVisible();
  await drawer.getByRole("button", { name: "Beta" }).click();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(/#\/overview\?workspace=Beta$/);
  await toggle.click();
  await expect(drawer.getByRole("button", { name: "Beta" })).toHaveAttribute("aria-current", "true");
  await drawer.getByRole("button", { name: "Beta" }).click();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(/#\/overview\?workspace=Beta$/);
  await toggle.click();
  await drawer.getByRole("button", { name: "Open Settings" }).click();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(/#\/user-settings\?workspace=Beta$/);
  await toggle.click();
  page.once("dialog", (dialog) => dialog.accept("Gamma"));
  await drawer.getByRole("button", { name: "Create workspace" }).click();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(/#\/overview\?workspace=Gamma$/);
  const integrations = page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", {
    name: "Integrations",
  });
  await integrations.click();
  await expect(page).toHaveURL(/#\/integrations\?workspace=Gamma$/);
  await expect(integrations).toHaveAttribute("aria-current", "page");
  await expect(page.locator("[data-user-settings-main]")).toBeVisible();
  const providerHeading = page.locator("[data-connectors-page] h2", { hasText: "Provider connections" });
  await expect(providerHeading).toBeVisible();
  await expect(providerHeading).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("mobile-integrations.png") });
  for (const width of [320, 540, 767]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(drawer).toBeVisible();
    const drawerWidth = await page
      .locator("[data-drawer-panel]")
      .evaluate((panel) => panel.getBoundingClientRect().width);
    expect(drawerWidth).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  }
  await toggle.click();
  await expect(drawer).toBeVisible();
  await page.setViewportSize({ width: 768, height: 844 });
  await expect(drawer).toBeHidden();
  await expect(page.locator("[data-mobile-menu]")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("aside")).toBeVisible();
  await expect(toggle).toBeHidden();
  await expect(page.locator("aside button").first()).toBeFocused();
});
