const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3000/ws');

ws.on('open', function open() {
    console.log('connected');
    ws.close();
});

ws.on('error', function error(err) {
    console.error('error:', err.message);
});

ws.on('close', function close() {
    console.log('disconnected');
});
