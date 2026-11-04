import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { getTodayPayments } from "./payments.js";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "papa-payment-tracker-api" });
});

app.get("/api/payments/today", async (_req, res) => {
  try {
    const result = await getTodayPayments();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("Fetch payments failed:", error);
    res.status(500).json({
      success: false,
      message: "Could not fetch payments. Check the collector connection."
    });
  }
});

const port = Number(process.env.PORT || 4000);
app.listen(port, "0.0.0.0", () => {
  console.log(`Payment Tracker API listening on http://0.0.0.0:${port}`);
});
