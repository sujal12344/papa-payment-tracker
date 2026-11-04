import dotenv from "dotenv";
dotenv.config();

import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const profileDir = path.resolve(__dirname, "../.google-messages-profile");

async function checkWelcome() {
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

  await page.goto("https://messages.google.com/web/authentication", {
    waitUntil: "networkidle"
  });

  console.log("Current URL:", page.url());

  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("button, a, [role='button']")).map(b => ({
      tag: b.tagName,
      text: b.innerText.trim(),
      href: b.getAttribute("href")
    }));
  });

  console.log("Buttons / Links on page:", JSON.stringify(buttons.filter(b => b.text.length > 0), null, 2));

  await context.close();
}

checkWelcome();

