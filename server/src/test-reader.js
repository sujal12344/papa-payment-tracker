import dotenv from "dotenv";
dotenv.config();

// Ensure MOCK_MODE is false for the test
process.env.MOCK_MODE = "false";

import { getMessagesFromGoogle } from "./googleMessages.js";
import { parsePaymentSms } from "./parser.js";

console.log("==================================================");
console.log("   TESTING GOOGLE MESSAGES LIVE SMS READER");
console.log("==================================================");
console.log("Connecting to saved profile and reading messages...\n");

async function runTest() {
  try {
    const rawMessages = await getMessagesFromGoogle();

    console.log(`✅ Raw SMS count fetched: ${rawMessages.length}`);
    if (rawMessages.length === 0) {
      console.log("⚠️ Koi message extract nahi hua. DOM selectors verify kar rahe hain...");
    } else {
      console.log("\nSample Raw Messages (Top 5):");
      rawMessages.slice(0, 5).forEach((m, i) => {
        console.log(`[${i + 1}] Sender: ${m.senderId}`);
        console.log(`    Body: ${m.body}`);
        console.log(`    Time: ${new Date(m.timestamp).toLocaleTimeString("en-IN")}\n`);
      });
    }

    console.log("--------------------------------------------------");
    console.log("Parsing for UPI / Bank Payment transactions...\n");

    const parsedPayments = rawMessages
      .map(parsePaymentSms)
      .filter(Boolean);

    console.log(`🎉 Parsed Payment SMS found: ${parsedPayments.length}`);

    parsedPayments.forEach((p, i) => {
      console.log(`[Payment ${i + 1}] ${p.direction === "credit" ? "🟢 CREDIT" : "🟠 DEBIT"}`);
      console.log(`  Amount: ₹${p.amount}`);
      console.log(`  Customer: ${p.payerName}`);
      console.log(`  UPI Ref: ${p.transactionId || "N/A"}`);
      console.log(`  Sender: ${p.senderId}`);
      console.log(`  Time: ${new Date(p.timestamp).toLocaleTimeString("en-IN")}`);
      console.log(`  Raw: ${p.rawMessage}\n`);
    });

    console.log("==================================================");
    console.log("Test finished successfully!");
    console.log("==================================================");
  } catch (err) {
    console.error("❌ Error while reading Google Messages:", err);
  }
}

runTest();

