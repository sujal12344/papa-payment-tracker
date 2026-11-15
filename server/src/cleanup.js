import { db } from './db.js';

console.log("Cleaning invalid records from payments.db...");

// Delete Groww / NEFT / fake 16380 records
const deleteGroww = db.prepare(`
  DELETE FROM payments 
  WHERE rawMessage LIKE '%NEFT%' 
     OR rawMessage LIKE '%GR0WW%' 
     OR rawMessage LIKE '%GROWW%'
     OR senderId LIKE '%NSEIPO%'
     OR id LIKE 'AD-KOTAKB-S%'
`);
const result = deleteGroww.run();
console.log(`Deleted ${result.changes} invalid NEFT/Groww records.`);

// Also list remaining records
const remaining = db.prepare("SELECT id, amount, direction, senderId, datetime(timestamp/1000, 'unixepoch', 'localtime') as dt, substr(rawMessage, 1, 40) as preview FROM payments ORDER BY timestamp DESC").all();
console.log("\nRemaining clean records in payments.db (" + remaining.length + "):");
console.table(remaining);
