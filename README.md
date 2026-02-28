# RFID Wallet Transaction System

**Live Dashboard URL:** [http://157.173.101.159:3001](http://157.173.101.159:3001)

This project implements a complete RFID Wallet Transaction System strictly following the architecture pattern of Edge Controllers (ESP8266) communicating via MQTT, and a Cloud Backend (VPS) communicating with a Web Dashboard via HTTP and WebSockets.

## 1. Description & MQTT Topics Used
This project uses strictly isolated MQTT topics under the `code888` namespace to ensure zero overlap with other teams. No wildcard subscriptions are used.

**Team ID:** `code888`
**Base Topic:** `rfid/code888/`

* **`rfid/code888/card/status`** (ESP8266 -> Backend): Published when a card is scanned, containing the `uid` and current `balance`.
* **`rfid/code888/card/topup`** (Backend -> ESP8266): Instructs the ESP8266 to credit the scanned card's physical memory by a specific `amount`.
* **`rfid/code888/card/pay`** (Backend -> ESP8266): Instructs the ESP8266 to process a payment by deducting the `amount` from the card's physical memory. The ESP rejects the transaction natively if funds are insufficient.
* **`rfid/code888/card/balance`** (ESP8266 -> Backend): Contains the success `new_balance` after a successful read/write operation. This acts as the final confirmation for Safe Wallet Updates.
* **`rfid/code888/card/error`** (ESP8266 -> Backend): Transmits rejection errors (e.g., Insufficient funds, failed read) back to the backend.

## 2. API Endpoints Implemented
The backend utilizes express.js to provide REST HTTP endpoints for dashboard commands.

*   `POST /topup` : Queues an admin credit operation for a card. Body: `{ uid: string, amount: number }`
*   `POST /pay` : Queues a debit payment for a product/service. Body: `{ uid: string, amount: number }`
*   `GET /api/transactions` : Returns a history ledger of all completed payments/top-ups.
*   `GET /api/products` : Returns the store menu config.
*   `GET /api/stats` : Returns aggregate statistics for the dashboard (Total Revenue, Transactions).

## 3. Database Schema (SQLite)
The application uses SQLite (`transactions.db`) to safely persist the wallet updates over 3 distinct tables:

**Table: `cards`**
Tracks the latest verified balance for every card interaction.
*   `uid` (TEXT PRIMARY KEY) - The UID of the RFID card.
*   `balance` (INTEGER DEFAULT 0) - The current balance of the card.

**Table: `transactions`**
The primary transaction ledger recording every Top-Up and Payment.
*   `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
*   `uid` (TEXT NOT NULL) - Card that initialized the transaction.
*   `type` (TEXT NOT NULL) - Evaluates to either 'TOPUP' or 'PAY'.
*   `amount` (INTEGER NOT NULL) - Monetary change.
*   `status` (TEXT NOT NULL) - Current status (Defaults to 'COMPLETED' upon Safe Wallet Update).
*   `created_at` (DATETIME DEFAULT CURRENT_TIMESTAMP)

**Table: `products`**
Defines the shop catalog for cashier interface matching.
*   `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
*   `name` (TEXT NOT NULL)
*   `price` (INTEGER NOT NULL)

## 4. Safe Wallet Update Approach (Critical Implementation)
The system obeys the absolute `all-or-nothing` principle. 
1. When a cashier submits a `/pay` post request via the HTTP API, no ledger is written in SQLite right away. Instead, a payment request is registered in physical memory cache.
2. The VPS translates it to an MQTT standard packet and shoots it to the Edge Controller (`card/pay` topic).
3. The ESP8266 verifies card funds. If there is enough balance, it commits the physical block rewrite to the RFID card, then verifies it and emits the `card/balance` topic confirmation.
4. Only upon receiving the confirmed `card/balance` topic from the ESP8266, the VPS simultaneously issues an SQL `BEGIN TRANSACTION`, updating the `cards` balance record, creating the `transactions` ledger entry, and committing it seamlessly (or discarding entirely upon error).

## 5. Software Interfaces
We successfully separated the roles:
*   **Web Dashboard (App)**: Listens passively to continuous WebSockets for updates without polling. Displays overall accounting metrics.
*   **Top-Up Interface (Admin)**: Dedicated UI for selecting Cards and adding credit securely.
*   **Payment Interface (Cashier)**: Follows a traditional Point-of-Sale UI allowing selection of Products, Quantity, calculation of exact totals, and submitting safe debits.
