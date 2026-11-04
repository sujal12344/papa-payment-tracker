# Papa Payment Tracker — Prototype

A starter prototype for an Android app + Node.js API + Playwright Google Messages reader.

## Important architecture

- **Papa's Android app (Expo / React Native):** displays today's transactions and calls the API on Refresh.
- **Node.js API:** validates requests and returns normalized payment records.
- **Playwright worker:** runs on an always-on computer/server that is paired to Google Messages Web. It reads the target conversation and parses messages.
- **PostgreSQL (recommended for production):** stores normalized transactions and deduplicates by transaction reference. This prototype uses an in-memory mock repository so it runs without a database.

Google Messages does not provide a public SMS-fetch API. Playwright DOM automation is unofficial and may break when Google changes its UI. The `googleMessages.js` file is deliberately a scaffold: selectors need to be inspected and tested against the actual paired session. Do not treat an SMS as definitive proof of bank credit.

## Why not SQLite?

SQLite is excellent for a single-device/local prototype. For this use case the collector and papa's app are separate devices and the API must be reachable remotely. PostgreSQL (or Supabase Postgres) is a better production fit for concurrent access, remote hosting, backups, access control and future reporting. This prototype avoids locking you into a DB before the message extraction is proven.

## Requirements

- Node.js 20+
- npm
- For Android app: Expo Go for initial UI testing, then EAS/local Android build for APK.
- A computer/server that stays on and has an active Google Messages Web paired session.

## Run the API

```bash
cd server
cp .env.example .env
npm install
npm run dev
```

API: `http://localhost:4000`
Health: `GET /api/health`
Today's payments: `GET /api/payments/today`

The API starts with sample data (`MOCK_MODE=true`). This lets you test the app before connecting Google Messages.

## Run the Android app

```bash
cd mobile
npm install
npx expo start
```

Set `EXPO_PUBLIC_API_BASE_URL` in `mobile/.env` to the server's reachable LAN URL, e.g. `http://192.168.1.20:4000`. Do not use `localhost` on papa's phone; it means papa's phone itself.

## Connect Google Messages later

1. Run the collector on the computer that owns the paired Google Messages Web session.
2. Pair Google Messages Web manually once in a persistent browser profile.
3. Inspect the actual DOM in Chrome DevTools.
4. Replace the TODO selectors in `server/src/googleMessages.js`.
5. Keep the browser profile private. Never commit it or expose it over the internet.
6. Add authentication and HTTPS before remote access.

## Data format

Each payment has:
- `id`
- `amount`
- `direction` (`credit` / `debit` / `unknown`)
- `payerName`
- `senderId`
- `timestamp`
- `transactionId`
- `rawMessage` (kept only for debugging in prototype; avoid storing full SMS in production)

## Security checklist before real use

- Add authentication for papa's app.
- Use HTTPS and rate limiting.
- Do not expose Playwright or Chrome debugging ports publicly.
- Store only parsed payment fields where possible.
- Validate credit/debit from the full SMS text; do not infer from color or sender ID.
- Deduplicate by bank transaction reference, not amount/time alone.
- Show "SMS reported" rather than "bank verified".
