import { chromium } from "playwright";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const profileDir = path.resolve(__dirname, "../.google-messages-profile");
const chromeExe = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

let activeBrowser = null;
let activePage = null;

async function getOrLaunchPage() {
  if (activePage && !activePage.isClosed()) {
    return activePage;
  }

  // 1. Try to connect to already running Chrome via remote debugging
  try {
    activeBrowser = await chromium.connectOverCDP("http://127.0.0.1:9222");
    const contexts = activeBrowser.contexts();
    const context = contexts[0] || activeBrowser;
    const pages = context.pages();
    activePage =
      pages.find((p) => p.url().includes("messages.google.com")) ||
      pages[0] ||
      (await context.newPage());
    return activePage;
  } catch {
    // Chrome not already running with CDP
  }

  // 2. Launch Chrome if not running
  const chromeProcess = spawn(
    chromeExe,
    [
      `--remote-debugging-port=9222`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "https://messages.google.com/web/conversations"
    ],
    {
      detached: true,
      stdio: "ignore"
    }
  );
  chromeProcess.unref();

  // Wait for CDP to become available
  for (let i = 0; i < 20; i++) {
    try {
      activeBrowser = await chromium.connectOverCDP("http://127.0.0.1:9222");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  if (!activeBrowser) {
    throw new Error(
      "Chrome ko launch nahi kiya ja saka. Kripya `npm run pair` chala kar check karein."
    );
  }

  const contexts = activeBrowser.contexts();
  const context = contexts[0] || activeBrowser;
  const pages = context.pages();
  activePage =
    pages.find((p) => p.url().includes("messages.google.com")) ||
    pages[0] ||
    (await context.newPage());

  return activePage;
}

/**
 * Scrapes recent SMS messages from Google Messages Web.
 */
export async function getMessagesFromGoogle() {
  const page = await getOrLaunchPage();

  if (!page.url().includes("/conversations")) {
    await page.goto("https://messages.google.com/web/conversations", {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });
  }

  await page.waitForTimeout(2000);

  // Check if user is redirected to welcome/auth (meaning not logged in)
  if (
    page.url().includes("welcome") ||
    page.url().includes("authentication") ||
    page.url().includes("accounts.google.com")
  ) {
    throw new Error(
      "Google Messages logged in nahi hai! Terminal me `npm run pair` chala kar Google sign-in karein."
    );
  }

  // Scrape conversation list
  const messages = await page.evaluate(() => {
    // Find all conversation list items or conversation links
    const items = Array.from(
      document.querySelectorAll(
        "mws-conversation-list-item, mw-conversation-list-item, [role='listitem'], a[href*='conversation']"
      )
    );

    const now = Date.now();

    return items
      .map((item) => {
        // Extract sender name / shortcode
        const nameEl =
          item.querySelector(
            ".name, h3, h2, .contact-name, [data-e2e-contact-name]"
          ) || item.querySelector(".title");
        const senderId = nameEl ? nameEl.textContent.trim() : "";

        // Extract last message text snippet
        const snippetEl =
          item.querySelector(
            ".snippet-text, .snippet, .last-message, [data-e2e-conversation-snippet]"
          ) || item.querySelector(".subtitle");
        const body = snippetEl ? snippetEl.textContent.trim() : "";

        // Extract timestamp label (e.g. "12:30 PM", "Yesterday")
        const timeEl = item.querySelector(
          ".timestamp, [data-e2e-timestamp], time"
        );
        const timeText = timeEl ? timeEl.textContent.trim() : "";

        let timestamp = now;
        if (timeText) {
          const matchTime = timeText.match(/(\d{1,2}):(\d{2})(?:\s*([AP]M))?/i);
          if (matchTime) {
            let hours = parseInt(matchTime[1], 10);
            const minutes = parseInt(matchTime[2], 10);
            const meridiem = matchTime[3]?.toUpperCase();

            if (meridiem === "PM" && hours < 12) hours += 12;
            if (meridiem === "AM" && hours === 12) hours = 0;

            const d = new Date();
            d.setHours(hours, minutes, 0, 0);
            timestamp = d.getTime();
          }
        }

        return { senderId, body, timestamp };
      })
      .filter((m) => m.senderId && m.body);
  });

  return messages;
}
