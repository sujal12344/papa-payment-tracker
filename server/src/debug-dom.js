import dotenv from "dotenv";
dotenv.config();

import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const profileDir = path.resolve(__dirname, "../.google-messages-profile");

async function debugDOM() {
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: "chrome",
    headless: false,
    viewport: null,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--start-maximized"
    ],
    ignoreDefaultArgs: ["--enable-automation"]
  });

  const page = context.pages()[0] || (await context.newPage());

  await page.goto("https://messages.google.com/web/", {
    waitUntil: "domcontentloaded"
  });

  console.log("Waiting 6 seconds for conversations to render...");
  await page.waitForTimeout(6000);

  const debugInfo = await page.evaluate(() => {
    const tags = Array.from(new Set(Array.from(document.querySelectorAll("*")).map((e) => e.tagName.toLowerCase())));
    const customElements = tags.filter((t) => t.includes("-") || t.startsWith("mw"));

    return {
      url: window.location.href,
      title: document.title,
      customElements
    };
  });

  console.log("Current URL:", debugInfo.url);
  console.log("Page Title:", debugInfo.title);
  console.log("Custom Elements on Page:", debugInfo.customElements);

  await context.close();
}

debugDOM();
