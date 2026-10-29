import { expect, test } from "@playwright/test";

/**
 * Walk through the seeded Demo Project: toggle a flag, watch the polling
 * client pick it up on the next fetch, and find the audit row.
 * Assumes the frontend and a seeded API are already running.
 */
test("seeded demo project: toggle shows up on the next fetch and is audited", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(page.getByText("Demo Project").first()).toBeVisible();
  await page.getByRole("link", { name: "Open demo" }).click();

  await expect(page.getByRole("heading", { name: "Demo Project" })).toBeVisible();
  await expect(page.getByRole("button", { name: "production · prod" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("demo@flagship.dev").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Five-minute demo" })).toBeVisible();
  await expect(page.getByText("node examples/node-demo/index.mjs")).toBeVisible();

  for (const name of ["Flags", "Live demo", "Audit log", "Settings"]) {
    await expect(page.getByRole("tab", { name })).toBeVisible();
  }

  await page.getByRole("tab", { name: "Flags" }).click();
  await expect(page.getByText("New Checkout Flow")).toBeVisible();

  await page.getByRole("tab", { name: "Live demo" }).click();
  await expect(page.getByRole("heading", { name: /SDK view/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fetches", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Evaluate", exact: true })).toBeVisible();
  await expect(page.getByLabel("Context")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Health" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Guided checklist" })).toBeVisible();
  await expect(page.getByText(/^polling/)).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Compare" }).first().click();
  await expect(page.getByText("Server", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Turn off" }).first().click();
  await page.getByRole("button", { name: "Apply in production" }).click();
  await expect(page.getByText(/new-checkout is off in v\d+/)).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Inspect audit" }).click();
  await expect(page.getByText("Control-plane writes are appended")).toBeVisible();
  await expect(page.getByLabel("Search")).toBeVisible();
  await expect(page.locator("span", { hasText: /^flag\.killswitch$/ })).toBeVisible();

  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Operator identity" })).toBeVisible();
  await expect(page.getByLabel("Actor email")).toBeVisible();
  await expect(page.getByLabel("Admin API key")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save identity" })).toBeVisible();

  const development = page.getByRole("button", { name: "development", exact: true });
  await development.click();
  await expect(development).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("tab", { name: "Flags" }).click();
  await expect(page.getByText("New Checkout Flow")).toBeVisible();

  await page.getByRole("link", { name: "Projects" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
});
