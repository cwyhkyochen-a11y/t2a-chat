/**
 * Minimal t2a-chat host — echo bot with form block
 *
 * Run:
 *   npm install
 *   node server.js
 *   Open http://localhost:4000/chat
 */

const http = require('http');
const Database = require('better-sqlite3');
const { ToolRegistry } = require('@t2a/core');
const { createChatApp } = require('@t2a/chat');

const db = new Database('./data/echo.db');
db.pragma('journal_mode = WAL');

// --- Tools: echo + timer (demonstrates system_event push) ---

function createTools({ userId, conversationId, pushSystemEvent }) {
  const tools = new ToolRegistry();

  tools.register({
    schema: {
      name: 'echo',
      description: 'Echo back the user message',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
    },
    handler: async (args) => ({ ok: true, echo: args.text }),
  });

  tools.register({
    schema: {
      name: 'set_timer',
      description: 'Set a timer that fires a system_event after N seconds',
      parameters: {
        type: 'object',
        properties: { seconds: { type: 'number' }, label: { type: 'string' } },
        required: ['seconds'],
      },
    },
    handler: async (args) => {
      const label = args.label || 'Timer';
      setTimeout(() => {
        pushSystemEvent(conversationId, {
          source: 'timer',
          payload: { label, message: `⏰ ${label} — ${args.seconds}s elapsed` },
          triggerAgent: true,
        });
      }, args.seconds * 1000);
      return { ok: true, message: `Timer "${label}" set for ${args.seconds}s` };
    },
  });

  return tools;
}

// --- App ---

const chat = createChatApp({
  db,
  auth: {
    resolveUser: async (req) => {
      // Demo: accept any password, user = password value
      const pw = req.headers['x-password'] || req.cookies?.pw;
      if (!pw) return null;
      return { id: pw, name: pw };
    },
  },
  adminAuth: (req) => req.headers.authorization === 'Bearer admin',
  tools: createTools,
  basePath: '/chat',
  adminBasePath: '/chat-admin',
  enableFormBlocks: true,
  taskTypes: {
    echo: { label: 'Echo', description: 'Echo tasks' },
  },
});

const server = http.createServer();
const { handleRequest } = chat.attachToServer(server);

server.on('request', async (req, res) => {
  const handled = await handleRequest(req, res);
  if (handled === false) {
    // Serve static files from public/
    const url = req.url.split('?')[0];
    if (url === '/' || url === '/index.html') {
      const filePath = require('path').join(__dirname, 'public', 'index.html');
      if (require('fs').existsSync(filePath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        require('fs').createReadStream(filePath).pipe(res);
        return;
      }
    }
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(4000, () => {
  console.log('Echo bot running → http://localhost:4000/chat');
  console.log('Admin → http://localhost:4000/chat-admin');
});
