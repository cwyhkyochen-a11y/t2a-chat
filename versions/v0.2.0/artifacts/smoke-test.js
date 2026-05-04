// smoke-test.js — t2a-chat v0.2.0 P0 冒烟测试
// 验证所有新 endpoint 能响应
//
// 用法：cd t2a-chat && node versions/v0.2.0/artifacts/smoke-test.js

const http = require('http');
const path = require('path');
const Database = require('better-sqlite3');

// 使用临时数据库
const dbPath = path.join(__dirname, 'smoke-test.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const { createChatApp } = require(path.join(__dirname, '..', '..', '..', 'src'));

// mock user
const MOCK_USER = { id: 1, name: 'smoke-tester' };

const chat = createChatApp({
  db,
  auth: {
    resolveUser: async (req) => {
      // 从 header 读 x-test-user
      if (req.headers['x-test-user'] === 'smoke') return MOCK_USER;
      return null;
    },
    resolveWsUser: async (req) => MOCK_USER,
  },
  adminAuth: (req) => req.headers['x-admin'] === '1',
  tools: () => null,
  basePath: '/chat',
  adminBasePath: '/chat-admin',
  taskTypes: {
    image: {
      label: '图片生成',
      category: 'media',
      models: [
        { id: 'test-model-1', name: 'Test Model 1', capabilities: ['photo'] },
        { id: 'test-model-2', name: 'Test Model 2', capabilities: ['illustration'] },
      ],
      defaultModel: 'test-model-1',
      paramsSchema: { prompt: { type: 'text', required: true } },
      create: async (params, ctx) => ({ url: 'https://example.com/img.png' }),
      cancel: async (taskId, ctx) => {},
      getStatus: async (taskId, ctx) => null,
      render: 'image-card',
    },
    video: {
      label: '视频生成',
      category: 'media',
      models: [{ id: 'video-model-1', name: 'Video Model 1' }],
      defaultModel: 'video-model-1',
      // 模拟慢任务，防止 cancel 测试时已完成
      create: async (params, ctx) => {
        await new Promise(r => setTimeout(r, 5000));
        return { url: 'https://example.com/vid.mp4' };
      },
      cancel: async (taskId, ctx) => {},
    },
  },
  modelRouter: {
    defaults: { image: 'test-model-1', video: 'video-model-1' },
    rules: [],
  },
  sidebarLinks: [
    { url: './', label: 'Image', icon: '<svg/>' },
    { url: './video', label: 'Video', icon: '<svg/>' },
  ],
  branding: { name: 'SmokeTest', primaryColor: '#333' },
});

const server = http.createServer((req, res) => {
  // 不做任何处理 — attachToServer 的 handleRequest 接管
  res.writeHead(404);
  res.end('Not Found');
});

const { handleRequest } = chat.attachToServer(server);

// 包装：让 handleRequest 处理所有请求
const wrappedServer = http.createServer(async (req, res) => {
  const result = await handleRequest(req, res);
  if (result === false) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  }
});

// 测试用 fetch 替代
async function request(method, path, { body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      method, path, hostname: '127.0.0.1', port: TEST_PORT,
      headers: { 'Content-Type': 'application/json', 'x-test-user': 'smoke', ...headers },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const TEST_PORT = 19999 + Math.floor(Math.random() * 1000);
let passed = 0, failed = 0;

function assert(condition, label) {
  if (condition) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label}`); }
}

async function run() {
  wrappedServer.listen(TEST_PORT, '127.0.0.1');
  console.log(`\n🧪 t2a-chat v0.2.0 Smoke Test (port ${TEST_PORT})\n`);

  // T1: Task routes
  console.log('--- T1: Task Registry ---');
  const createRes = await request('POST', '/api/chat/tasks', {
    body: { type: 'image', params: { prompt: 'hello' }, conversation_id: null },
  });
  assert(createRes.status === 200 && createRes.body.ok, 'POST /tasks → 200 + ok');
  const taskId = createRes.body.task && createRes.body.task.id;
  assert(!!taskId, 'task id returned');

  const getRes = await request('GET', `/api/chat/tasks/${taskId}`);
  assert(getRes.status === 200 && getRes.body.id === taskId, 'GET /tasks/:id → 200');

  const listRes = await request('GET', '/api/chat/tasks');
  assert(listRes.status === 200 && Array.isArray(listRes.body.data), 'GET /tasks → 200 + array');

  // T2: Task Cancel
  console.log('\n--- T2: Task Cancel ---');
  const createRes2 = await request('POST', '/api/chat/tasks', {
    body: { type: 'video', params: { prompt: 'a cat' } },
  });
  const taskId2 = createRes2.body.task && createRes2.body.task.id;
  const cancelRes = await request('POST', `/api/chat/tasks/${taskId2}/cancel`);
  assert(cancelRes.status === 200 && cancelRes.body.ok, 'POST /tasks/:id/cancel → 200');
  const cancelledTask = await request('GET', `/api/chat/tasks/${taskId2}`);
  assert(cancelledTask.body.status === 'cancelled', 'task status is cancelled');
  assert(cancelledTask.body.cancelled_at != null, 'cancelled_at is set');

  // T3: Models
  console.log('\n--- T3: Models ---');
  const modelsRes = await request('GET', '/api/chat/models');
  assert(modelsRes.status === 200 && Array.isArray(modelsRes.body.models), 'GET /models → 200 + array');
  assert(modelsRes.body.models.length === 3, 'models count = 3 (2 image + 1 video)');
  assert(modelsRes.body.defaults.image === 'test-model-1', 'defaults.image = test-model-1');

  const modelsFilterRes = await request('GET', '/api/chat/models?taskType=image');
  assert(modelsFilterRes.body.models.length === 2, 'GET /models?taskType=image → 2');

  // Admin models
  const adminModelsRes = await request('GET', '/api/chat-admin/models', { headers: { 'x-admin': '1' } });
  assert(adminModelsRes.status === 200 && Array.isArray(adminModelsRes.body.models), 'Admin GET /models → 200');

  // T4: Auth
  console.log('\n--- T4: Auth (resolveUser) ---');
  const noAuthRes = await request('GET', '/api/chat/conversations', { headers: { 'x-test-user': '' } });
  assert(noAuthRes.status === 401, 'no auth → 401');

  const authRes = await request('GET', '/api/chat/conversations');
  assert(authRes.status === 200, 'with auth → 200');

  // T5: UI Config
  console.log('\n--- T5: Sidebar Links + UI Config ---');
  const uiRes = await request('GET', '/api/chat/config/ui');
  assert(uiRes.status === 200, 'GET /config/ui → 200');
  assert(Array.isArray(uiRes.body.sidebarLinks) && uiRes.body.sidebarLinks.length === 2, 'sidebarLinks = 2');
  assert(uiRes.body.branding && uiRes.body.branding.name === 'SmokeTest', 'branding.name = SmokeTest');

  // Admin tasks
  console.log('\n--- Admin ---');
  const adminTasksRes = await request('GET', '/api/chat-admin/tasks', { headers: { 'x-admin': '1' } });
  assert(adminTasksRes.status === 200 && Array.isArray(adminTasksRes.body.data), 'Admin GET /tasks → 200');

  // Summary
  console.log(`\n${'='.repeat(40)}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`${'='.repeat(40)}\n`);

  wrappedServer.close();
  db.close();
  // 清理临时 db
  const fs = require('fs');
  try { fs.unlinkSync(dbPath); } catch {}
  try { fs.unlinkSync(dbPath + '-wal'); } catch {}
  try { fs.unlinkSync(dbPath + '-shm'); } catch {}

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('💥 Fatal:', err);
  db.close();
  process.exit(1);
});
