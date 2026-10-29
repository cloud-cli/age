import { expect, test } from "@playwright/test";

test("workspace settings link a public Git repository once", async ({ page }) => {
  const repositoryUrl = "https://github.com/cloud-cli/age.git";
  let linkedUrl = "";
  let successAlert = "";
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("dialog", async (dialog) => {
    if (dialog.type() === "confirm") {
      await dialog.accept();
    } else {
      successAlert = dialog.message();
      await dialog.accept();
    }
  });
  await page.route("**/api/me", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ name: "Test User" }) }),
  );
  await page.route("**/teams/current", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "", role: "", members: [] }) }),
  );
  await page.route("**/models", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/connectors", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/workspaces**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();
    if (!pathname.startsWith("/workspaces")) {
      await route.continue();
      return;
    }
    if (pathname === "/workspaces") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify([{ name: "age-v1" }]) });
      return;
    }
    if (pathname === "/workspaces/age-v1/settings") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ name: "age-v1", description: "", goals: [], revision: 0, repositoryUrl: linkedUrl }),
      });
      return;
    }
    if (pathname === "/workspaces/age-v1/repository" && method === "POST") {
      const body = route.request().postDataJSON();
      linkedUrl = body.repositoryUrl;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ repositoryUrl: linkedUrl }) });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: "[]" });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/settings?workspace=age-v1");
  const repositoryInput = page.getByLabel("Public HTTPS repository URL");
  const linkButton = page.getByRole("button", { name: "Clone into workspace" });
  await expect(page.getByRole("heading", { name: "Git repository" })).toBeVisible();
  await expect(page.getByText(/stored on this server's disk/)).toBeVisible();
  await expect(linkButton).toBeVisible();
  await repositoryInput.fill(repositoryUrl);
  const linked = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/workspaces/age-v1/repository" && response.request().method() === "POST",
  );
  await linkButton.click();
  expect((await linked).status()).toBe(200);
  await expect(page.locator("[data-repository-current]")).toHaveText(`Connected: ${repositoryUrl}`);
  await expect(linkButton).toBeHidden();
  await expect(repositoryInput).toHaveAttribute("readonly", "");
  expect(successAlert).toBe("Repository cloned into workspace files.");

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator("[data-repository-current]")).toBeInViewport();
  expect(pageErrors).toEqual([]);
});
