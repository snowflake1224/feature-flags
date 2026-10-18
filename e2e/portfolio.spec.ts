import { expect, test } from "@playwright/test";

/**
 * Walk through the seeded Demo Project and exercise its showcase path.
 * Assumes `npm run dev:frontend` and a seeded API are already running.
 */
test("seeded demo project exposes core tabs and live demo", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(page.getByText("Demo Project").first()).toBeVisible();
  await page.getByRole("link", { name: "Open demo" }).click();

  await expect(page.getByRole("heading", { name: "Demo Project" })).toBeVisible();
  await expect(page.getByRole("button", { name: "production · prod" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("demo@flagship.dev").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Five-minute demo" })).toBeVisible();
  await expect(page.getByText("node examples/node-demo/index.mjs")).toBeVisible();

  for (const name of ["Flags", "Segments", "Experiments", "Live demo", "Audit log", "Settings"]) {
    await expect(page.getByRole("tab", { name })).toBeVisible();
  }

  await page.getByRole("tab", { name: "Flags" }).click();
  await expect(page.getByText("New Checkout Flow")).toBeVisible();
  await expect(page.getByText("Pricing Page Experiment")).toBeVisible();

  await page.getByRole("tab", { name: "Segments" }).click();
  await expect(page.getByText("Beta Users")).toBeVisible();
  await expect(page.getByText("beta-users")).toBeVisible();

  await page.getByRole("tab", { name: "Experiments" }).click();
  await expect(page.getByRole("button", { name: "Pricing Layout A/B" })).toBeVisible();

  await page.getByRole("tab", { name: "Live demo" }).click();
  await expect(page.getByRole("heading", { name: /Data plane/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stream" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Evaluate" })).toBeVisible();
  await expect(page.getByLabel("Context")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Event simulator" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Health" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Guided checklist" })).toBeVisible();
  await expect(page.getByText(/^live/)).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Compare" }).first().click();
  await expect(page.getByText("Server", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Turn off" }).first().click();
  await page.getByRole("button", { name: "Apply in production" }).click();
  await expect(page.getByText("patch", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/ms refresh/)).toBeVisible();

  await page.getByRole("button", { name: "Send exposure" }).click();
  await expect(page.getByText(/Sent pricing_viewed/)).toBeVisible();
  await page.getByRole("button", { name: "Send goal" }).click();
  await expect(page.getByText(/Sent subscribed/)).toBeVisible();
  await page.getByRole("button", { name: "Refresh results" }).click();
  await expect(page.getByText(/exposures/).last()).toBeVisible();

  await page.getByRole("button", { name: "Inspect audit" }).click();
  await expect(page.getByText("Control-plane writes are appended")).toBeVisible();
  await expect(page.getByLabel("Search")).toBeVisible();
  await expect(page.getByText("flag.killswitch").first()).toBeVisible();

  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Operator identity" })).toBeVisible();
  await expect(page.getByLabel("Actor email")).toBeVisible();
  await expect(page.getByLabel("Admin API key")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save identity" })).toBeVisible();

  await page.getByRole("button", { name: "development" }).click();
  await expect(page.getByRole("button", { name: "development" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("tab", { name: "Experiments" }).click();
  await expect(page.getByText("No experiments in this environment")).toBeVisible();

  await page.getByRole("button", { name: "production · prod" }).click();
  await expect(page.getByRole("button", { name: "production · prod" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("tab", { name: "Flags" }).click();
  await expect(page.getByText("New Checkout Flow")).toBeVisible();

  await page.getByRole("link", { name: "Projects" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
});
