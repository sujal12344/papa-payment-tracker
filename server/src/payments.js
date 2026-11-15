import { getMessagesFromGoogle } from "./googleMessages.js";
import { parsePaymentSms } from "./parser.js";
import { isPostgres, savePayments, getAllStoredPayments } from "./db.js";

function getSampleMessages() {
  const now = new Date();
  const d = (hours, minutes) => {
    const t = new Date(now);
    t.setHours(hours, minutes, 0, 0);
    return t.getTime();
  };

  return [
    {
      senderId: "BG-SLCBNK-T",
      body: "Rs.500.00 credited to your account from Rahul Sharma. UPI Ref 123456789012.",
      timestamp: d(10, 32)
    },
    {
      senderId: "VA-SLCBNK-S",
      body: "Rs.250.00 received from Amit Verma. UPI transaction reference 987654321098.",
      timestamp: d(11, 5)
    },
    {
      senderId: "BG-SLCBNK-T",
      body: "Rs.1,200.00 credited to your account from Priya Patel. UPI Ref 445566778899.",
      timestamp: d(11, 45)
    },
    {
      senderId: "BT-SLCBNK-T",
      body: "Rs.100.00 debited from your account for Petrol. UPI Ref 555555555555.",
      timestamp: d(12, 10)
    },
    {
      senderId: "VA-SLCBNK-S",
      body: "Rs.350.00 received from Sunita Devi. UPI transaction reference 778899001122.",
      timestamp: d(12, 28)
    }
  ];
}

export async function getTodayPayments() {
  let rawMessages = [];
  try {
    rawMessages = process.env.MOCK_MODE === "false"
      ? await getMessagesFromGoogle()
      : getSampleMessages();
  } catch (err) {
    console.log("Live SMS fetch bypassed or unavailable, using database records:", err.message);
  }

  // Parse raw messages
  const parsedPayments = rawMessages
    .map(parsePaymentSms)
    .filter(Boolean);

  // Store in DB (PostgreSQL or SQLite) and track how many new payments were added
  const newPaymentsCount = await savePayments(parsedPayments);

  // Retrieve all stored payments from DB
  const allStored = await getAllStoredPayments();

  // Calculate Date Boundaries
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const yesterdayEnd = new Date(todayStart);

  // Today specific calculations
  const todayCredits = allStored.filter(
    (p) =>
      p.direction === "credit" &&
      p.timestamp >= todayStart.getTime() &&
      p.timestamp < todayEnd.getTime()
  );
  const todayDebits = allStored.filter(
    (p) =>
      p.direction === "debit" &&
      p.timestamp >= todayStart.getTime() &&
      p.timestamp < todayEnd.getTime()
  );
  const todayReceived = todayCredits.reduce((sum, p) => sum + p.amount, 0);

  // Yesterday specific calculations
  const yesterdayCredits = allStored.filter(
    (p) =>
      p.direction === "credit" &&
      p.timestamp >= yesterdayStart.getTime() &&
      p.timestamp < yesterdayEnd.getTime()
  );
  const yesterdayReceived = yesterdayCredits.reduce((sum, p) => sum + p.amount, 0);

  // All time total
  const allCredits = allStored.filter((p) => p.direction === "credit");
  const allTimeTotal = allCredits.reduce((sum, p) => sum + p.amount, 0);

  const todayStr = `${todayStart.getFullYear()}-${String(todayStart.getMonth() + 1).padStart(2, "0")}-${String(todayStart.getDate()).padStart(2, "0")}`;

  return {
    date: todayStr,
    totalReceived: todayReceived, // Accurate for TODAY
    transactionCount: todayCredits.length,
    todayDebitCount: todayDebits.length,
    yesterdayTotal: yesterdayReceived,
    yesterdayCount: yesterdayCredits.length,
    allTimeTotal,
    allTimeCount: allCredits.length,
    newPaymentsCount,
    lastRefreshedAt: new Date().toISOString(),
    sourceStatus: process.env.MOCK_MODE === "false" ? "google-messages" : "demo-data",
    dbType: isPostgres ? "PostgreSQL (Cloud)" : "SQLite (Local)",
    payments: allStored
  };
}
