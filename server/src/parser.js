const moneyPattern = /(?:INR|Rs\\.?|₹)\\s*([\\d,]+(?:\\.\\d{1,2})?)/i;
const refPattern = /(?:UPI\\s*(?:Ref(?:erence)?|Txn(?:\\s*ID)?)?\\s*[:#-]?\\s*)([A-Z0-9]{8,})/i;

export function parsePaymentSms(message) {
  const body = String(message.body || "");
  const senderId = String(message.senderId || "");
  if (!senderId.includes("SLCBNK")) return null;

  const amountMatch = body.match(moneyPattern);
  if (!amountMatch) return null;

  const lower = body.toLowerCase();
  let direction = "unknown";
  if (/(credited|received|credit to|deposited)/i.test(body)) direction = "credit";
  if (/(debited|sent|withdrawn|paid|debit from)/i.test(body)) direction = "debit";

  const transactionId = body.match(refPattern)?.[1] || null;
  const payerMatch =
    body.match(/(?:from|by)\\s+([A-Za-z][A-Za-z .'-]{1,40}?)(?:[.,;]|\\s+UPI|\\s+Ref|$)/i);

  return {
    id: transactionId || `${senderId}-${message.timestamp}-${amountMatch[1]}`,
    amount: Number(amountMatch[1].replaceAll(",", "")),
    direction,
    payerName: payerMatch?.[1]?.trim() || "Name not available",
    senderId,
    timestamp: Number(message.timestamp),
    transactionId,
    rawMessage: body
  };
}
