
import { chromium } from "playwright";
import readline from "node:readline/promises";

const profile = "./.google-messages-profile";

const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  viewport: { width: 1400, height: 900 }
});

const page = context.pages()[0] || await context.newPage();

await page.goto("https://messages.google.com/web/");

console.log("\nGoogle Messages opened!");
console.log("Scan the QR code using your phone.");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

await rl.question("After pairing is complete, press ENTER here...");

console.log("Pairing session saved in browser profile.");

rl.close();
await context.close();
