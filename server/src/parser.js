const moneyPattern = /(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)/i;
const refPattern = /(?:UPI\s*(?:transaction\s*)?(?:Ref(?:erence)?|Txn(?:\s*ID)?|no\.?|number)?\s*[:#-]?\s*)([A-Z0-9]{8,})/i;

const configuredSenders = (process.env.SENDER_IDS || "")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

export function parsePaymentSms(message) {
  const body = String(message.body || "");
  const senderId = String(message.senderId || "").toUpperCase();

  // If sender IDs are configured, check if matches, otherwise check for standard bank sender shortcodes
  if (configuredSenders.length > 0) {
    const isAllowed = configuredSenders.some(
      (s) => senderId.includes(s) || s.includes(senderId)
    );
    // If not in configuredSenders, also allow if body clearly has credit/UPI
    if (!isAllowed && !/UPI|credit|credited|received|bank/i.test(body)) {
      return null;
    }
  }

  const amountMatch = body.match(moneyPattern);
  if (!amountMatch) return null;

  let direction = "unknown";
  if (/(credited|received|credit to|deposited)/i.test(body)) direction = "credit";
  if (/(debited|sent|withdrawn|paid|debit from)/i.test(body)) direction = "debit";

  // If not credit or debit, ignore non-payment promotional messages
  if (direction === "unknown") return null;

  const transactionId = body.match(refPattern)?.[1] || null;

  let payerName = "Customer";
  const payerMatch = body.match(
    /(?:from|by)\s+([A-Za-z][A-Za-z0-9 .'-]{1,40}?)(?:[.,;]|\s+UPI|\s+Ref|\s+for|$)/i
  );

  if (payerMatch?.[1]) {
    const rawPayer = payerMatch[1].trim();
    if (/your account/i.test(rawPayer)) {
      payerName = direction === "debit" ? "Shop / Account Debit" : "Customer";
    } else {
      payerName = rawPayer;
    }
  }

  return {
    id: transactionId || `${senderId}-${message.timestamp}-${amountMatch[1]}`,
    amount: Number(amountMatch[1].replaceAll(",", "")),
    direction,
    payerName,
    senderId,
    timestamp: Number(message.timestamp),
    transactionId,
    rawMessage: body
  };
}
