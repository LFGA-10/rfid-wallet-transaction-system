const express = require('express');
const mqtt = require('mqtt');
const WebSocket = require('ws');
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const HTTP_PORT = 3001;
const MQTT_BROKER = 'mqtt://157.173.101.159';
const TEAM_ID = 'code888';

const TOPIC_STATUS = `rfid/${TEAM_ID}/card/status`;
const TOPIC_TOPUP = `rfid/${TEAM_ID}/card/topup`;
const TOPIC_PAY = `rfid/${TEAM_ID}/card/pay`;
const TOPIC_BALANCE = `rfid/${TEAM_ID}/card/balance`;
const TOPIC_ERROR = `rfid/${TEAM_ID}/card/error`;

const dbFile = path.join(__dirname, 'transactions.db');
const db = new sqlite3.Database(dbFile, (err) => {
  if (err) console.error('[DB]', err.message);
  else {
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS cards (
            uid TEXT PRIMARY KEY,
            balance INTEGER DEFAULT 0
        )`);
      db.run(`CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price INTEGER NOT NULL
        )`);

      db.run(`INSERT OR IGNORE INTO products (id, name, price) VALUES (1, 'Coffee', 3), (2, 'Sandwich', 5), (3, 'Juice', 2)`);

      db.run(`CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uid TEXT NOT NULL,
            type TEXT NOT NULL,
            amount INTEGER NOT NULL,
            status TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

      db.run(`UPDATE transactions SET status = 'FAILED' WHERE status = 'PENDING'`);
    });
  }
});

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname)));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

function broadcast(topic, data) {
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ topic, data }));
  });
}

const mqttClient = mqtt.connect(MQTT_BROKER);
mqttClient.on('connect', () => {
  mqttClient.subscribe([TOPIC_STATUS, TOPIC_BALANCE, TOPIC_ERROR]);
  console.log('[MQTT] Connected and subscribed to topics for team', TEAM_ID);
});

let pendingQueue = {};

mqttClient.on('message', (topic, message) => {
  let parsed;
  try { parsed = JSON.parse(message.toString()); } catch { parsed = message.toString(); }

  console.log(`[MQTT IN] ${topic}`, parsed);
  broadcast(topic, parsed);

  if (topic === TOPIC_STATUS && parsed.uid) {
    const uid = parsed.uid;
    if (pendingQueue[uid]) {
      const q = pendingQueue[uid];
      const pubTopic = q.type === 'TOPUP' ? TOPIC_TOPUP : TOPIC_PAY;
      console.log(`[SYSTEM] Auto-triggering ${q.type} for ${uid}`);
      mqttClient.publish(pubTopic, JSON.stringify({ uid, amount: q.amount }));
    }
  }

  if (topic === TOPIC_BALANCE && parsed.uid) {
    const uid = parsed.uid;
    const newBal = parsed.new_balance;
    const type = parsed.type || 'UNKNOWN';

    if (pendingQueue[uid]) {
      const q = pendingQueue[uid];

      db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        db.run(`INSERT OR IGNORE INTO cards (uid, balance) VALUES (?, ?)`, [uid, 0]);
        db.run(`UPDATE cards SET balance = ? WHERE uid = ?`, [newBal, uid]);
        db.run(`INSERT INTO transactions (uid, type, amount, status) VALUES (?, ?, ?, 'COMPLETED')`, [uid, q.type, q.amount]);
        db.run("COMMIT", (err) => {
          if (!err) {
            console.log(`[DB] Successfully committed ${q.type} ledger for ${uid}`);
            delete pendingQueue[uid];
            broadcast('server/tx_success', { uid, type: q.type, amount: q.amount, new_balance: newBal });
          } else {
            console.error("[DB] Commit error", err);
          }
        });
      });
    } else {
      db.serialize(() => {
        db.run(`INSERT OR IGNORE INTO cards (uid, balance) VALUES (?, ?)`, [uid, 0]);
        db.run(`UPDATE cards SET balance = ? WHERE uid = ?`, [newBal, uid]);
      });
    }
  }

  if (topic === TOPIC_ERROR && parsed.uid) {
    const uid = parsed.uid;
    if (pendingQueue[uid]) {
      console.log(`[SYSTEM] Error occurred for ${uid}, rolling back queue limits.`);
      delete pendingQueue[uid]; // Discard queue, meaning no transaction will ever be saved.
      broadcast('server/tx_error', { uid, error: parsed.error });
    }
  }
});

// HTTP Endpoints - Assignment specified at least /topup and /pay endpoints

app.post('/topup', (req, res) => {
  const { uid, amount } = req.body;
  if (!uid || typeof amount !== 'number' || amount <= 0) return res.status(400).json({ error: 'Invalid config' });

  // Save into pending queue
  pendingQueue[uid] = { type: 'TOPUP', amount };

  // Try immediate trigger in case card is already on reader perfectly
  mqttClient.publish(TOPIC_TOPUP, JSON.stringify({ uid, amount }));
  res.json({ success: true, message: 'Top-up queued for execution' });
});

app.post('/pay', (req, res) => {
  const { uid, amount } = req.body;
  if (!uid || typeof amount !== 'number' || amount <= 0) return res.status(400).json({ error: 'Invalid config' });

  // Save into pending queue
  pendingQueue[uid] = { type: 'PAY', amount };

  mqttClient.publish(TOPIC_PAY, JSON.stringify({ uid, amount }));
  res.json({ success: true, message: 'Payment queued for execution' });
});

// For Dashboard queries
app.get('/api/transactions', (req, res) => {
  db.all(`SELECT * FROM transactions ORDER BY created_at DESC LIMIT 50`, (err, rows) => {
    res.json(rows || []);
  });
});

app.get('/api/products', (req, res) => {
  db.all(`SELECT * FROM products`, (err, rows) => {
    res.json(rows || []);
  });
});

app.get('/api/stats', (req, res) => {
  let stats = {
    totalRevenue: 0,
    totalTransactions: 0
  };
  db.get(`SELECT SUM(amount) as total FROM transactions WHERE type = 'PAY' AND status = 'COMPLETED'`, (err, row1) => {
    if (row1 && row1.total) stats.totalRevenue = row1.total;
    db.get(`SELECT COUNT(*) as count FROM transactions WHERE status = 'COMPLETED'`, (err, row2) => {
      if (row2) stats.totalTransactions = row2.count;
      res.json(stats);
    });
  });
});

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', console.error);
});

server.listen(HTTP_PORT, () => console.log('[HTTP] Loaded HTTP APIs successfully, listening on', HTTP_PORT));
