import { expect, test } from "@playwright/test";

test.describe("Notes (/)", () => {
  test("opens and shows its content", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    const response = await page.goto("/");
    expect(response?.ok()).toBe(true);
    await expect(page).toHaveTitle("Notes");
    await expect(page.getByRole("button", { name: "Add", exact: true }).first()).toBeVisible();
    expect(errors).toEqual([]);
  });
});
