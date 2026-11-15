const moneyPattern = /(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)/i;

// Handles:
// - "UPI Ref 630780462345"
// - "UPI Ref:630759246095"
// - "UPI ref no. 630471002865"
// - "Ref ID. 630780462345"
// - "Ref ID: 667361029556"
const refPattern =
  /(?:UPI\s*(?:ref(?:erence)?|txn)?\s*(?:no\.?|id)?[.:#-]?\s*|Ref\s*ID[.:]?\s*)([A-Z0-9]{8,})/i;

// Match Slice Bank and major Indian bank shortcodes
const defaultPattern = "^[A-Z]{2}-(?:SLCBNK|KOTAKB|KOTAKD|HDFCBK|SBIUPI|SBIINB|AXISBK|ICICIB)-[A-Z]$";
const senderRegex = new RegExp(process.env.SENDER_PATTERN || defaultPattern, "i");

// Simple deterministic hash for non-UPI ID fallback (NEVER use Date.now())
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function parsePaymentSms(message) {
  const body = String(message.body || "");
  const senderId = String(message.senderId || "").toUpperCase();

  // 1. Immediately reject known non-bank senders (NSEIPO, Vi, Airtel, VI-CARE, etc.)
  if (/NSEIPO|VICARE|VIFIN|IRMS|TPower|Vi Finance/i.test(senderId)) {
    return null;
  }

  // 2. Validate sender with regex pattern or body bank keywords
  if (!senderRegex.test(senderId)) {
    const isBankUPI = /UPI|SLCBNK|slice|Kotak/i.test(body) && /credited|received|sent|debited/i.test(body);
    if (!isBankUPI) return null;
  }

  // 3. Strictly reject promotional loans, recharge, brokers, mutual funds, NEFT, RTGS, IPO, Mandates
  if (
    /loan|pre-approved|recharge|cashback|congratulations|exclusive deal|credit card bill|statement/i.test(body) ||
    /IPO\b|mandate|blocking of funds|collect request|block request|NSEIL|BSE\b/i.test(body) ||
    /NEFT|RTGS|GR[0O]WW|ZERODHA|UPSTOX|ANGELONE|5PAISA|DHAN|MUTUAL FUND|DIVIDEND|SALARY|INTEREST CREDITED/i.test(body)
  ) {
    return null;
  }

  const amountMatch = body.match(moneyPattern);
  if (!amountMatch) return null;

  let direction = "unknown";
  if (/(credited|received|credit to|deposited|got)/i.test(body)) direction = "credit";
  if (/(debited|sent|withdrawn|paid|debit from)/i.test(body)) direction = "debit";

  if (direction === "unknown") return null;

  const transactionId = body.match(refPattern)?.[1] || null;

  // Extract Customer / Payer Name
  let payerName = "Customer / UPI";
  const payerMatch = body.match(
    /(?:from|to)\s+([A-Za-z][A-Za-z0-9 .'-]{1,40}?)(?:\s+(?:in your|on \d|via|\(|UPI|Ref)|[.,;]|$)/i
  );

  if (payerMatch?.[1]) {
    const rawPayer = payerMatch[1].trim();
    if (!/Kotak|slice|your account|a\/c/i.test(rawPayer)) {
      payerName = rawPayer;
    } else if (/your account|a\/c/i.test(rawPayer)) {
      payerName = direction === "debit" ? "Shop / Account Debit" : "Customer";
    }
  }

  // Extract date from body if present (e.g. "on 08-Nov-26", "on 07-Nov-26", "on 03-11-26")
  let timestamp = Number(message.timestamp) || Date.now();
  const dateMatchAlpha = body.match(/on\s+(\d{1,2})[-/\s]([A-Za-z]{3})[-/\s](\d{2,4})/i);
  if (dateMatchAlpha) {
    const day = parseInt(dateMatchAlpha[1], 10);
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const month = months.indexOf(dateMatchAlpha[2].toLowerCase());
    if (month !== -1) {
      let year = parseInt(dateMatchAlpha[3], 10);
      if (year < 100) year += 2000;
      const d = new Date(year, month, day);
      const cur = new Date(timestamp);
      d.setHours(cur.getHours(), cur.getMinutes(), 0, 0);
      timestamp = d.getTime();
    }
  } else {
    const dateMatchNum = body.match(/on\s+(\d{1,2})[-/\s](\d{1,2})[-/\s](\d{2,4})/i);
    if (dateMatchNum) {
      const day = parseInt(dateMatchNum[1], 10);
      const month = parseInt(dateMatchNum[2], 10) - 1;
      let year = parseInt(dateMatchNum[3], 10);
      if (year < 100) year += 2000;
      const d = new Date(year, month, day);
      const cur = new Date(timestamp);
      d.setHours(cur.getHours(), cur.getMinutes(), 0, 0);
      timestamp = d.getTime();
    }
  }

  const cleanAmount = Number(amountMatch[1].replaceAll(",", ""));

  // DETERMINISTIC ID: Always stable, never duplicates on page refresh
  const stableId = transactionId || `${senderId}-${cleanAmount}-${hashString(body.slice(0, 80))}`;

  return {
    id: stableId,
    amount: cleanAmount,
    direction,
    payerName,
    senderId,
    timestamp,
    transactionId,
    rawMessage: body
  };
}
