const API = '/api/chat-admin';
let token = localStorage.getItem('admin_token');

// Auth
function ensureAuth() {
  if (!token) {
    const t = prompt('请输入 Admin Token:');
    if (!t) return ensureAuth();
    token = t;
    localStorage.setItem('admin_token', token);
  }
}

function headers() {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
}

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, { headers: headers(), ...opts });
  if (res.status === 401) {
    localStorage.removeItem('admin_token');
    token = null;
    ensureAuth();
    return api(path, opts);
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// Tabs
const tabs = document.querySelectorAll('.tab');
const contents = document.querySelectorAll('.tab-content');

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    contents.forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    loadTab(tab.dataset.tab);
  });
});

// Modal
function openModal(title, html) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal').classList.remove('hidden');
}
function closeModal() { document.getElementById('modal').classList.add('hidden'); }
document.getElementById('modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });

// Tab loaders
function loadTab(name) {
  const loaders = { config: loadConfig, tools: loadTools, sessions: loadSessions, providers: loadProviders };
  loaders[name]?.();
}

// ========== Tab 1: Config ==========
async function loadConfig() {
  const el = document.getElementById('tab-config');
  el.innerHTML = '<p>加载中...</p>';
  try {
    const cfg = await api('/config');
    const ovf = cfg.overflow || {};
    el.innerHTML = `
      <div class="card">
        <h3 style="margin-bottom:16px">基本配置</h3>
        <div class="form-group"><label>System Prompt</label><textarea id="c-system_prompt">${esc(cfg.system_prompt || '')}</textarea></div>
        <div class="form-group"><label>Model</label><input id="c-model" value="${esc(cfg.model || '')}"></div>
        <div class="form-group"><label>Base URL</label><input id="c-base_url" value="${esc(cfg.base_url || '')}"></div>
        <div class="form-group"><label>Temperature (0-2)</label><input type="number" id="c-temperature" value="${cfg.temperature ?? 0.7}" min="0" max="2" step="0.1"></div>
        <div class="form-group"><label>Max Tokens</label><input type="number" id="c-max_tokens" value="${cfg.max_tokens ?? 4096}"></div>
        <button class="btn btn-primary" onclick="saveConfig()">保存配置</button>
      </div>
      <hr class="divider">
      <div class="card">
        <h3 style="margin-bottom:16px">Overflow 配置</h3>
        <div class="form-group"><label>Strategy</label>
          <select id="o-strategy">
            <option value="truncate" ${ovf.overflow_strategy==='truncate'?'selected':''}>truncate</option>
            <option value="summarize" ${ovf.overflow_strategy==='summarize'?'selected':''}>summarize</option>
            <option value="reject" ${ovf.overflow_strategy==='reject'?'selected':''}>reject</option>
          </select>
        </div>
        <div class="form-group"><label>Context Max Tokens</label><input type="number" id="o-max_tokens" value="${ovf.context_max_tokens ?? 8000}"></div>
        <div class="form-group"><label>Keep Last N</label><input type="number" id="o-keep_last_n" value="${ovf.overflow_keep_last_n ?? 10}"></div>
        <div class="form-group"><label>Warning Ratio (0-1)</label><input type="number" id="o-warning_ratio" value="${ovf.overflow_warning_ratio ?? 0.8}" min="0" max="1" step="0.05"></div>
        <button class="btn btn-primary" onclick="saveOverflow()">保存 Overflow</button>
      </div>`;
  } catch (e) { el.innerHTML = `<p style="color:red">加载失败: ${e.message}</p>`; }
}

async function saveConfig() {
  const body = {
    system_prompt: document.getElementById('c-system_prompt').value,
    model: document.getElementById('c-model').value,
    base_url: document.getElementById('c-base_url').value,
    temperature: parseFloat(document.getElementById('c-temperature').value),
    max_tokens: parseInt(document.getElementById('c-max_tokens').value),
  };
  await api('/config', { method: 'PUT', body: JSON.stringify(body) });
  alert('已保存');
}

async function saveOverflow() {
  const body = {
    overflow_strategy: document.getElementById('o-strategy').value,
    context_max_tokens: parseInt(document.getElementById('o-max_tokens').value),
    overflow_keep_last_n: parseInt(document.getElementById('o-keep_last_n').value),
    overflow_warning_ratio: parseFloat(document.getElementById('o-warning_ratio').value),
  };
  await api('/overflow', { method: 'PUT', body: JSON.stringify(body) });
  alert('已保存');
}

// ========== Tab 2: Tools ==========
async function loadTools() {
  const el = document.getElementById('tab-tools');
  el.innerHTML = '<p>加载中...</p>';
  try {
    const tools = await api('/tools');
    if (!tools.length) { el.innerHTML = '<p>暂无工具</p>'; return; }
    el.innerHTML = tools.map((t, i) => `
      <div class="card">
        <div class="tool-name">${esc(t.name)}</div>
        <div class="tool-desc">${esc(t.description || '无描述')}</div>
        <button class="toggle-schema" onclick="toggleSchema(${i})">展开 Parameters</button>
        <pre class="tool-schema" id="schema-${i}">${esc(JSON.stringify(t.parameters, null, 2))}</pre>
      </div>`).join('');
  } catch (e) { el.innerHTML = `<p style="color:red">加载失败: ${e.message}</p>`; }
}

function toggleSchema(i) {
  const s = document.getElementById(`schema-${i}`);
  s.classList.toggle('open');
}

// ========== Tab 3: Sessions ==========
let sessPage = 1;
async function loadSessions(page) {
  if (page) sessPage = page;
  const el = document.getElementById('tab-sessions');
  el.innerHTML = '<p>加载中...</p>';
  try {
    const data = await api(`/sessions?page=${sessPage}&pageSize=20`);
    const sessions = data.sessions || data.data || data;
    const total = data.total || sessions.length;
    const totalPages = Math.ceil(total / 20);
    el.innerHTML = `
      <table>
        <thead><tr><th>ID</th><th>标题</th><th>消息数</th><th>创建时间</th><th>操作</th></tr></thead>
        <tbody>${(Array.isArray(sessions) ? sessions : []).map(s => `
          <tr>
            <td>${esc(s.id?.slice(0,8) || s.id)}</td>
            <td>${esc(s.title || '无标题')}</td>
            <td>${s.message_count ?? s.messages?.length ?? '-'}</td>
            <td>${fmtDate(s.created_at)}</td>
            <td>
              <button class="btn btn-ghost" onclick="viewSession('${s.id}')">详情</button>
              <button class="btn btn-danger" onclick="deleteSession('${s.id}')">删除</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div class="pagination">
        ${sessPage > 1 ? `<button class="btn btn-ghost" onclick="loadSessions(${sessPage-1})">上一页</button>` : ''}
        <span style="line-height:34px">第 ${sessPage} / ${totalPages || 1} 页</span>
        ${sessPage < totalPages ? `<button class="btn btn-ghost" onclick="loadSessions(${sessPage+1})">下一页</button>` : ''}
      </div>`;
  } catch (e) { el.innerHTML = `<p style="color:red">加载失败: ${e.message}</p>`; }
}

async function viewSession(id) {
  const data = await api(`/sessions/${id}`);
  const msgs = data.messages || data;
  const html = (Array.isArray(msgs) ? msgs : []).map(m => `
    <div class="msg msg-${m.role}">
      <div class="msg-role">${m.role}</div>
      <div>${esc(m.content || '')}</div>
    </div>`).join('');
  openModal('会话详情', html || '<p>无消息</p>');
}

async function deleteSession(id) {
  if (!confirm('确定删除该会话？')) return;
  await api(`/sessions/${id}`, { method: 'DELETE' });
  loadSessions();
}

// ========== Tab 4: Providers ==========
async function loadProviders() {
  const el = document.getElementById('tab-providers');
  el.innerHTML = '<p>加载中...</p>';
  try {
    const providers = await api('/llm-providers');
    const list = Array.isArray(providers) ? providers : providers.data || [];
    el.innerHTML = `
      <button class="btn btn-primary" style="margin-bottom:12px" onclick="editProvider()">+ 新增 Provider</button>
      <table>
        <thead><tr><th>名称</th><th>Base URL</th><th>模型</th><th>优先级</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${list.map(p => `
          <tr>
            <td>${esc(p.name)}</td>
            <td>${esc(p.base_url || '')}</td>
            <td>${esc(p.model || '')}</td>
            <td>${p.priority ?? '-'}</td>
            <td>${p.enabled !== false ? '✅' : '❌'}</td>
            <td>
              <button class="btn btn-ghost" onclick='editProvider(${JSON.stringify(p).replace(/'/g,"&#39;")})'>编辑</button>
              <button class="btn btn-danger" onclick="deleteProvider('${p.id || p.name}')">删除</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (e) { el.innerHTML = `<p style="color:red">加载失败: ${e.message}</p>`; }
}

function editProvider(p) {
  p = p || {};
  const html = `
    <div class="form-group"><label>Name</label><input id="p-name" value="${esc(p.name || '')}"></div>
    <div class="form-group"><label>Base URL</label><input id="p-base_url" value="${esc(p.base_url || '')}"></div>
    <div class="form-group"><label>API Key</label><input id="p-api_key" value="${esc(p.api_key || '')}" type="password"></div>
    <div class="form-group"><label>Model</label><input id="p-model" value="${esc(p.model || '')}"></div>
    <div class="form-group"><label>Priority</label><input type="number" id="p-priority" value="${p.priority ?? 0}"></div>
    <button class="btn btn-primary" onclick="saveProvider('${p.id || ''}')">保存</button>`;
  openModal(p.id ? '编辑 Provider' : '新增 Provider', html);
}

async function saveProvider(id) {
  const body = {
    name: document.getElementById('p-name').value,
    base_url: document.getElementById('p-base_url').value,
    api_key: document.getElementById('p-api_key').value,
    model: document.getElementById('p-model').value,
    priority: parseInt(document.getElementById('p-priority').value),
  };
  if (id) {
    await api(`/llm-providers/${id}`, { method: 'PUT', body: JSON.stringify(body) });
  } else {
    await api('/llm-providers', { method: 'POST', body: JSON.stringify(body) });
  }
  closeModal();
  loadProviders();
}

async function deleteProvider(id) {
  if (!confirm('确定删除？')) return;
  await api(`/llm-providers/${id}`, { method: 'DELETE' });
  loadProviders();
}

// ========== Utils ==========
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function fmtDate(d) { if (!d) return '-'; return new Date(d).toLocaleString('zh-CN'); }

// Init
ensureAuth();
loadTab('config');
