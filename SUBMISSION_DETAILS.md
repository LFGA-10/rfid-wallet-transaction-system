# Submission Details

**Live Dashboard URL:**
http://157.173.101.159:3001

**Team ID / Namespace:** `code888`

## MQTT Topics Used:
*   `rfid/code888/card/status` (ESP8266 -> VPS): Publishes UID & raw balance on scan.
*   `rfid/code888/card/topup` (VPS -> ESP8266): VPS commands ESP to execute a physical memory top-up (credit).
*   `rfid/code888/card/pay` (VPS -> ESP8266): VPS commands ESP to natively run a debit sequence. ESP rejects if funds are short. 
*   `rfid/code888/card/balance` (ESP8266 -> VPS): ESP confirms a successful flash memory balance update. Acts as our "Safe Wallet Update" trigger.
*   `rfid/code888/card/error` (ESP8266 -> VPS): Returns declined transactions (e.g., insufficient funds).

## API Endpoints Implemented:
*   `POST /topup`: Admin endpoint for queueing a safe wallet update (Credit). Body: `{uid, amount}`
*   `POST /pay`: Cashier endpoint for queueing an all-or-nothing product purchase (Debit). Body: `{uid, amount}`
*   `GET /api/transactions`: Dashboard ledger fetching real-time SQLite history.
*   `GET /api/stats`: Dashboard summary fetching aggregate Revenue/Transactions.
*   `GET /api/products`: Populates Cashier catalog items & prices.

## Database Schema (SQLite):
We use `transactions.db` spanning 3 tables:
1. `cards`: `uid` (Primary Key), `balance` (Integer). Tracks verified physical wallet totals.
2. `transactions`: `id` (Auto-inc), `uid` (Text), `type` ('TOPUP' or 'PAY'), `amount` (Integer), `status` (Text), `created_at`.
3. `products`: `id`, `name`, `price`. Holds dynamic shop inventory for cashier menu.

*System uses strict `BEGIN TRANSACTION` -> `INSERT log` -> `COMMIT` triggered only upon receiving the `card/balance` MQTT confirmation to guarantee the "All-or-Nothing" safe wallet requirement.*
