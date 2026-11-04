import dotenv from "dotenv";
dotenv.config();

import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const profileDir = path.resolve(__dirname, "../.google-messages-profile");

async function checkConversations() {
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

  console.log("Navigating directly to https://messages.google.com/web/conversations ...");
  await page.goto("https://messages.google.com/web/conversations", {
    waitUntil: "domcontentloaded"
  });

  console.log("Waiting 8 seconds for conversations to load...");
  await page.waitForTimeout(8000);

  const res = await page.evaluate(() => {
    // Collect all elements that look like conversation items
    const allTags = Array.from(new Set(Array.from(document.querySelectorAll("*")).map((e) => e.tagName.toLowerCase())));
    const custom = allTags.filter((t) => t.includes("-") || t.startsWith("mw"));

    // Look for text in the page
    const items = Array.from(document.querySelectorAll("mws-conversation-list-item, mw-conversation-list-item, [role='listitem'], a[href*='conversation']"));

    const snippets = items.slice(0, 10).map((el) => el.innerText.trim());

    return {
      url: window.location.href,
      title: document.title,
      customTags: custom,
      itemCount: items.length,
      sampleSnippets: snippets
    };
  });

  console.log("Final URL:", res.url);
  console.log("Custom Tags:", res.customTags);
  console.log("Items found:", res.itemCount);
  console.log("Snippets:", res.sampleSnippets);

  await context.close();
}

checkConversations();

