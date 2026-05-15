import { test, expect } from "@playwright/test";

test("/trending renders without NaN% or +null% in any badge", async ({ page }) => {
  await page.goto("/trending");
  // 页面要么显示空状态,要么显示卡片网格 —— 两种都不能含坏文案
  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toContain("NaN");
  expect(bodyText).not.toContain("null%");
  // 标题始终在
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("/trending platform filter is interactive", async ({ page }) => {
  await page.goto("/trending");
  const tiktokBtn = page.getByRole("button", { name: "TikTok" });
  // 空状态下筛选器可能不渲染;有数据时点击不报错
  if (await tiktokBtn.isVisible()) {
    await tiktokBtn.click();
    await expect(page.locator("body")).not.toContainText("NaN");
  }
});
