const fs = require('fs');
const WebSocket = require('ws');

function log(msg) {
    fs.appendFileSync('debug_ws.log', msg + '\n');
}

log('Starting diagnostic...');
log('Attempting to connect to ws://localhost:3000/ws ...');
const ws = new WebSocket('ws://localhost:3000/ws');

ws.on('open', function open() {
    log('SUCCESS: Connected to WebSocket server!');
    ws.close();
    process.exit(0);
});

ws.on('error', function error(err) {
    log('ERROR: Connection failed: ' + err.message);
    process.exit(1);
});

ws.on('close', function close(code, reason) {
    log(`CLOSED: Connection closed. Code: ${code}, Reason: ${reason}`);
});

setTimeout(() => {
    log('TIMEOUT: Could not connect within 5 seconds.');
    ws.terminate();
    process.exit(1);
}, 5000);
