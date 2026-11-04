import { getMessagesFromGoogle } from "./googleMessages.js";
import { parsePaymentSms } from "./parser.js";

const sampleMessages = [
  {
    senderId: "BG-SLCBNK-T",
    body: "Rs.500.00 credited to your account from Rahul Sharma. UPI Ref 123456789012.",
    timestamp: new Date().setHours(10, 32, 0, 0)
  },
  {
    senderId: "VA-SLCBNK-S",
    body: "Rs.250.00 received from Amit. UPI transaction reference 987654321098.",
    timestamp: new Date().setHours(11, 5, 0, 0)
  },
  {
    senderId: "BT-SLCBNK-T",
    body: "Rs.100.00 debited from your account. UPI Ref 555555555555.",
    timestamp: new Date().setHours(11, 20, 0, 0)
  }
];

export async function getTodayPayments() {
  const messages = process.env.MOCK_MODE === "false"
    ? await getMessagesFromGoogle()
    : sampleMessages;

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const payments = messages
    .filter((m) => m.timestamp >= start.getTime() && m.timestamp < end.getTime())
    .map(parsePaymentSms)
    .filter(Boolean)
    .sort((a, b) => b.timestamp - a.timestamp);

  const received = payments.filter((p) => p.direction === "credit");
  const totalReceived = received.reduce((sum, p) => sum + p.amount, 0);

  return {
    date: start.toISOString().slice(0, 10),
    totalReceived,
    transactionCount: received.length,
    lastRefreshedAt: new Date().toISOString(),
    sourceStatus: process.env.MOCK_MODE === "false" ? "google-messages" : "demo-data",
    payments
  };
}
