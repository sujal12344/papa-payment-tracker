import { chromium } from "playwright";

/**
 * Playwright integration scaffold.
 *
 * Google Messages Web has no public SMS-fetch API. This browser automation is
 * unofficial and DOM selectors must be inspected against the currently rendered
 * page. The conversation URL is intentionally not hard-coded: find the target
 * conversation by sender/header text after loading the web app.
 */
export async function getMessagesFromGoogle() {
  const profile = process.env.GOOGLE_MESSAGES_PROFILE || "./.google-messages-profile";
  const url = process.env.GOOGLE_MESSAGES_URL || "https://messages.google.com/web/";

  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    viewport: { width: 1400, height: 900 }
  });

  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });

    // First run: manually pair the phone in this visible browser window.
    // Keep this profile directory between runs so the session can be reused.
    // TODO: inspect DOM and select the conversation by its sender/header.
    // TODO: read message bubbles and their timestamps from the DOM.
    // TODO: return [{ senderId, body, timestamp }] for the parser.
    throw new Error(
      "Google Messages DOM selectors are not configured yet. Set up pairing, inspect the page, then implement the TODO selectors in googleMessages.js."
    );
  } finally {
    await context.close();
  }
}
