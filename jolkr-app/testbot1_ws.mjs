const TOKEN = process.argv[2];
const WS_URL = 'ws://localhost/ws';
const BOT_ID = '3a7d1e9e-7826-422b-bd67-480340d4fc52';

const ws = new WebSocket(WS_URL);

ws.addEventListener('open', () => {
  console.log('[testbot1] Connected, sending Identify...');
  ws.send(JSON.stringify({ op: 'Identify', d: { token: TOKEN } }));
});

ws.addEventListener('message', async (event) => {
  const msg = JSON.parse(event.data);
  if (msg.op === 'HeartbeatAck') return;
  console.log(`[testbot1] Event: ${msg.op}`, JSON.stringify(msg.d));

  // Auto-reply to messages
  if (msg.op === 'MessageCreate') {
    const m = msg.d.message;
    if (m.author_id === BOT_ID) return; // don't reply to self
    const dmId = m.channel_id;
    const reply = `Hey! Je zei: "${m.content}" 👋`;
    console.log(`[testbot1] Replying: ${reply}`);
    try {
      const res = await fetch(`http://localhost/api/dms/${dmId}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: reply }),
      });
      console.log(`[testbot1] Reply sent: ${res.status}`);
    } catch (e) {
      console.log('[testbot1] Reply error:', e.message);
    }
  }

  // Auto-accept calls
  if (msg.op === 'DmCallRing') {
    console.log(`[testbot1] *** INCOMING CALL from ${msg.d.caller_username}! Auto-accepting in 3s...`);
    setTimeout(async () => {
      try {
        const res = await fetch(`http://localhost/api/dms/${msg.d.dm_id}/call/accept`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        });
        console.log(`[testbot1] Accept response: ${res.status}`);
      } catch (e) {
        console.log('[testbot1] Accept error:', e.message);
      }
    }, 3000);
  }
});

ws.addEventListener('close', () => console.log('[testbot1] Disconnected'));
ws.addEventListener('error', (e) => console.log('[testbot1] Error:', e.message));

setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ op: 'Heartbeat', d: { seq: Date.now() } }));
  }
}, 30000);

console.log('[testbot1] Bot active — auto-replies to messages + auto-accepts calls');
