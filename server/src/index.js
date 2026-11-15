import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import https from "https";
import { getTodayPayments } from "./payments.js";
import { parsePaymentSms } from "./parser.js";
import { savePayments } from "./db.js";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "papa-payment-tracker-api",
    mode: process.env.MOCK_MODE === "false" ? "live-google-messages" : "mock-demo"
  });
});

// Authentic Hindi Soundbox TTS Streaming
app.get("/api/tts", (req, res) => {
  const text = String(req.query.text || "").trim();
  if (!text) {
    return res.status(400).json({ error: "Missing text query parameter" });
  }
  const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=hi&client=tw-ob`;

  https.get(ttsUrl, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } }, (stream) => {
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    stream.pipe(res);
  }).on("error", (err) => {
    console.error("TTS fetch error:", err.message);
    res.status(500).json({ error: "TTS generation failed" });
  });
});

app.get("/api/payments/today", async (_req, res) => {
  try {
    const result = await getTodayPayments();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("Fetch payments failed:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Could not fetch payments. Check the collector connection."
    });
  }
});

// Real-time Push Notification Webhook (for Slice / Kotak phone alerts)
app.post("/api/payments/webhook", async (req, res) => {
  try {
    const { body, text, message, senderId, title } = req.body || {};
    const content = body || text || message || title || "";
    if (!content) {
      return res.status(400).json({ success: false, error: "Missing message text in body" });
    }

    const parsed = parsePaymentSms({
      body: content,
      senderId: senderId || "SLICE-NOTIFICATION",
      timestamp: Date.now()
    });

    if (!parsed) {
      return res.status(200).json({
        success: true,
        ignored: true,
        message: "Message received but not classified as a valid store payment"
      });
    }

    const inserted = await savePayments([parsed]);
    res.json({
      success: true,
      inserted: inserted > 0,
      payment: parsed
    });
  } catch (error) {
    console.error("Webhook processing error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

const port = Number(process.env.PORT || 4000);
app.listen(port, "0.0.0.0", () => {
  console.log(`Payment Tracker API listening on http://0.0.0.0:${port} [MOCK_MODE=${process.env.MOCK_MODE}]`);
});
