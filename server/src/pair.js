import { spawn } from "child_process";
import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const profileDir = path.resolve(__dirname, "../.google-messages-profile");
const chromeExe = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

console.log("==================================================");
console.log("   GOOGLE MESSAGES OFFICIAL LOGIN SETUP");
console.log("==================================================");
console.log(`Profile: ${profileDir}`);
console.log("Launching genuine Chrome natively (bypassing Google security blocks)...\n");

async function start() {
  // Launch Chrome as an independent native Windows application with remote debugging
  const chromeProcess = spawn(
    chromeExe,
    [
      `--remote-debugging-port=9222`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "https://messages.google.com/web/"
    ],
    {
      detached: true,
      stdio: "ignore"
    }
  );
  chromeProcess.unref();

  console.log("Chrome open ho gaya hai!");
  console.log("\n👉 STEPS TO COMPLETE LOGIN:");
  console.log("1. Chrome me 'Sign in' par click karein.");
  console.log("2. Wahi Google account choose karein jo aapke phone ke Google Messages me active hai.");
  console.log("3. Phone par emoji verification prompt aayega -> Match emoji choose karein.");
  console.log("4. Login hote hi aapke saare SMS screen par dikh jayenge.\n");
  console.log("Connecting CDP to monitor login status...");

  // Wait for Chrome port 9222 to be ready
  let browser = null;
  for (let i = 0; i < 30; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  if (!browser) {
    console.log("Chrome launch ho chuka hai. Kripya Chrome window me sign-in complete karein.");
    return;
  }

  const contexts = browser.contexts();
  const context = contexts[0] || browser;
  
  console.log("Waiting for you to sign in inside the Chrome window...");

  // Poll until user completes sign in and lands on conversations
  const checkInterval = setInterval(async () => {
    try {
      const pages = context.pages();
      for (const p of pages) {
        const url = p.url();
        if (url.includes("/conversations")) {
          clearInterval(checkInterval);
          console.log("\n🎉 LOGIN SUCCESSFUL!");
          console.log("Aapka Google Messages account successfully pair/sign-in ho gaya!");
          console.log("Profile ./.google-messages-profile me permanently save ho gayi hai.");
          console.log("Ab aap server test kar sakte hain: npm run test:reader\n");
          process.exit(0);
        }
      }
    } catch {
      // browser might be navigating
    }
  }, 2000);
}

start();
