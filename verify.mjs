import { createRequire } from "module";
import { pathToFileURL } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const root = path.dirname(new URL(import.meta.url).pathname);
const url = pathToFileURL(path.join(root, "index.html")).href;
const browser = await chromium.launch({
  headless: true,
  channel: "chrome",
});
const page = await browser.newPage({
  viewport: { width: 360, height: 800 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
});
await page.goto(url);
await page.waitForLoadState("networkidle");
await page.screenshot({ path: path.join(root, "screenshots", "android-home-360x800.png") });

await page.locator(".home .composer input").fill("帮我规划一下本周社媒内容");
await page.keyboard.press("Enter");
await page.waitForTimeout(900);
await page.screenshot({ path: path.join(root, "screenshots", "android-home-thinking-360x800.png") });

await page.locator(".home [data-new-chat]").click();
await page.waitForTimeout(1800);

await page.getByLabel("打开侧边栏").first().click();
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(root, "screenshots", "android-drawer-360x800.png") });

await page.locator("[data-nav='expert']").last().click();
await page.waitForTimeout(350);
await page.screenshot({ path: path.join(root, "screenshots", "android-expert-initial-360x800.png") });

await page.locator(".expert [data-plus]").click();
await page.waitForTimeout(1900);
await page.screenshot({ path: path.join(root, "screenshots", "android-expert-attachment-360x800.png") });

await page.locator(".expert .composer input").fill("帮我把这个视频拆解成多条facebook图文推文");
await page.locator(".expert [data-plus]").click();
await page.waitForTimeout(450);
await page.screenshot({ path: path.join(root, "screenshots", "android-expert-top-360x800.png") });

await page.locator("#expertScroll").evaluate((el) => {
  el.scrollTop = el.scrollHeight;
});
await page.waitForTimeout(250);
await page.getByRole("button", { name: "需要" }).click();
await page.getByRole("button", { name: "点击跳转" }).click();
await page.waitForTimeout(350);
await page.screenshot({ path: path.join(root, "screenshots", "android-expert-bottom-360x800.png") });

const state = await page.evaluate(() => ({
  view: document.querySelector(".app")?.dataset.view,
  homeMode: document.querySelector(".home")?.dataset.mode,
  mode: document.querySelector(".expert")?.dataset.mode,
  hasAttachment: document.querySelector(".expert .composer")?.classList.contains("has-attachment"),
  scheduleText: document.querySelector("[data-schedule]")?.textContent,
  jumpText: document.querySelector("[data-jump]")?.textContent,
  toast: document.querySelector(".toast")?.textContent,
}));

console.log(JSON.stringify(state, null, 2));
await browser.close();
