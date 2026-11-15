import { chromium } from "playwright";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const profileDir = path.resolve(__dirname, "../.google-messages-profile");
const chromeExe = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

let activeBrowser = null;
let activePage = null;

async function getOrLaunchPage() {
  if (activePage && !activePage.isClosed()) {
    return activePage;
  }

  // 1. Try to connect to already running Chrome via remote debugging (port 9222)
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

  // Guard against non-existent Chrome executable (e.g. on Linux or cloud hosts like Render)
  if (!fs.existsSync(chromeExe)) {
    throw new Error(
      `Chrome executable not found at ${chromeExe}. Browser scraping requires local Windows Chrome.`
    );
  }

  // 2. Launch Chrome
  const isHeadless = process.env.HEADLESS !== "false"; // Default to true for minimum RAM & computation
  const chromeArgs = [
    `--remote-debugging-port=9222`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "https://messages.google.com/web/conversations"
  ];

  if (isHeadless) {
    chromeArgs.push("--headless=new");
  }

  const chromeProcess = spawn(chromeExe, chromeArgs, {
    detached: true,
    stdio: "ignore"
  });
  // Attach error handler to prevent unhandled 'error' event crash
  chromeProcess.on("error", (err) => {
    console.warn("⚠️ Chrome process launch warning (ignored):", err.message);
  });
  chromeProcess.unref();

  // Wait for CDP to become available (fast timeout to keep API responsive)
  for (let i = 0; i < 6; i++) {
    try {
      activeBrowser = await chromium.connectOverCDP("http://127.0.0.1:9222");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
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
 * Scrapes recent SMS messages from Google Messages Web,
 * with scrolling support to capture all bank conversations (Slice, Kotak, etc.).
 */
export async function getMessagesFromGoogle() {
  const isRender = Boolean(process.env.RENDER || process.env.IS_RENDER);
  const isLinux = process.platform !== "win32";
  const hasChrome = fs.existsSync(chromeExe);

  // In cloud environment (like Render) or Linux without desktop Chrome:
  // Skip browser scraping, serve live data from Hosted PostgreSQL & Webhooks
  if (isRender || isLinux || !hasChrome) {
    return [];
  }
  const page = await getOrLaunchPage();

  if (!page.url().includes("/conversations")) {
    await page.goto("https://messages.google.com/web/conversations", {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });
  }

  await page.waitForTimeout(1500);

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

  // Scrape conversation list with automatic virtual list scrolling
  const messages = await page.evaluate(async () => {
    const scrollEl =
      document.querySelector("mws-conversations-list")?.parentElement ||
      document.querySelector("mws-conversations-list") ||
      document.querySelector("[role='navigation']") ||
      window;

    const allFound = new Map();
    const now = new Date();

    // Helper inside evaluate to parse time text into accurate timestamp
    function parseTimestamp(timeText) {
      if (!timeText) return now.getTime();
      const t = timeText.trim();

      // 1. Time today: "12:30 PM", "9:15 AM", "15:40"
      const matchTime = t.match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
      if (matchTime) {
        let hours = parseInt(matchTime[1], 10);
        const minutes = parseInt(matchTime[2], 10);
        const mer = matchTime[3]?.toUpperCase();
        if (mer === "PM" && hours < 12) hours += 12;
        if (mer === "AM" && hours === 12) hours = 0;
        const d = new Date(now);
        d.setHours(hours, minutes, 0, 0);
        return d.getTime();
      }

      // 2. Yesterday
      if (/yesterday|kal/i.test(t)) {
        const d = new Date(now);
        d.setDate(d.getDate() - 1);
        d.setHours(12, 0, 0, 0);
        return d.getTime();
      }

      // 3. Day of week: "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"
      const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
      const dayIndex = days.indexOf(t.toLowerCase().slice(0, 3));
      if (dayIndex !== -1) {
        const currentDay = now.getDay();
        let diff = currentDay - dayIndex;
        if (diff <= 0) diff += 7; // e.g. today Sunday(0) - Sat(6) = -6 -> +7 = 1 day ago
        const d = new Date(now);
        d.setDate(d.getDate() - diff);
        d.setHours(12, 0, 0, 0);
        return d.getTime();
      }

      // 4. Date: "8 Nov", "08-Nov", "31 Oct", "3 Nov"
      const matchDate = t.match(/(\d{1,2})\s+([A-Za-z]{3})/i);
      if (matchDate) {
        const day = parseInt(matchDate[1], 10);
        const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
        const month = months.indexOf(matchDate[2].toLowerCase());
        if (month !== -1) {
          const d = new Date(now);
          d.setMonth(month, day);
          d.setHours(12, 0, 0, 0);
          return d.getTime();
        }
      }

      // Fallback: Default to yesterday if unrecognized relative text, to prevent falsely declaring it as "Today"
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      return d.getTime();
    }

    // Scroll through the conversation list 7 times to capture older threads
    for (let scrollStep = 0; scrollStep < 7; scrollStep++) {
      const items = Array.from(
        document.querySelectorAll(
          "mws-conversation-list-item, mw-conversation-list-item, [role='listitem'], a[href*='conversation']"
        )
      );

      for (const item of items) {
        const nameEl =
          item.querySelector(".name, h3, h2, .contact-name, [data-e2e-contact-name]") ||
          item.querySelector(".title");
        const senderId = nameEl ? nameEl.textContent.trim() : "";

        const snippetEl =
          item.querySelector(".snippet-text, .snippet, .last-message, [data-e2e-conversation-snippet]") ||
          item.querySelector(".subtitle");
        const body = snippetEl ? snippetEl.textContent.trim() : "";

        const timeEl = item.querySelector(".timestamp, [data-e2e-timestamp], time");
        const timeText = timeEl ? timeEl.textContent.trim() : "";

        // Skip non-bank senders right away
        if (/NSEIPO|VICARE|VIFIN|IRMS|TPower|Vi Finance/i.test(senderId)) {
          continue;
        }

        if (senderId && body) {
          const key = `${senderId}-${body.slice(0, 45)}`;
          if (!allFound.has(key)) {
            const timestamp = parseTimestamp(timeText);
            allFound.set(key, { senderId, body, timestamp });
          }
        }
      }

      // Scroll container down
      if (scrollEl && scrollEl.scrollBy) {
        scrollEl.scrollBy(0, 500);
      } else if (window.scrollBy) {
        window.scrollBy(0, 500);
      }
      await new Promise((r) => setTimeout(r, 400));
    }

    // Scroll back to top for clean state
    if (scrollEl && scrollEl.scrollTo) {
      scrollEl.scrollTo(0, 0);
    }

    return Array.from(allFound.values());
  });

  return messages;
}
