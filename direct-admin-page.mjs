import { buildAdminClientUtils, buildAdminSharedStyles } from "./admin-shared.mjs";

export function buildDirectAdminHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Cursor Direct Gateway</title>
  <style>${buildAdminSharedStyles()}</style>
</head>
<body>
  <div class="login-wrap" id="loginView">
    <section class="login" data-motion>
      <div class="brand">
        <div class="mark">CD</div>
        <div>
          <h1>Cursor Direct Gateway</h1>
          <div class="sub">直连账号池管理台 · CPA 单页控制台</div>
        </div>
      </div>
      <p>输入管理密码后，可在同一页面完成账号池总览、导入、OAuth 登录、探针测试与 NewAPI 接入配置。</p>
      <div class="field">
        <label for="adminPassword">管理密码</label>
        <input id="adminPassword" type="password" autocomplete="current-password" placeholder="输入管理密码" />
      </div>
      <div class="row" style="margin-top: 14px;">
        <button class="primary" id="loginBtn">进入管理台</button>
        <button class="ghost" id="rememberBtn" type="button">记住本浏览器</button>
      </div>
      <div class="toast" id="loginStatus" style="margin-top: 12px;">等待输入管理密码。</div>
    </section>
  </div>

  <main class="shell hidden" id="appView">
    <header class="topbar" data-motion>
      <div class="brand">
        <div class="mark">CD</div>
        <div>
          <div class="title">Cursor Direct Gateway</div>
          <div class="sub" id="runtimeLine">正在读取运行状态...</div>
        </div>
      </div>
      <div class="actions">
        <button class="primary" id="refreshBtn">刷新全部</button>
        <button id="copyBaseBtn">复制 Base URL</button>
        <button class="ghost" id="logoutAdminBtn">退出</button>
      </div>
    </header>

    <section class="hero-panel" data-motion>
      <div class="hero-head">
        <div>
          <div class="hero-kicker">Direct Gateway · 账号池控制台</div>
          <div class="hero-title">号池总览与运维，一屏完成</div>
          <div class="hero-copy">多账号轮询直连 Cursor 上游，对外提供 OpenAI 兼容 <code>/v1</code> 接口。</div>
        </div>
        <div class="status-pills">
          <span class="pill good" id="healthPill">运行状态读取中</span>
          <span class="pill" id="memoryPill">内存读取中</span>
          <span class="pill" id="modelPill">模型读取中</span>
        </div>
      </div>

      <section class="metric-grid six">
        <div class="metric" data-motion>
          <div class="label">账号总数</div>
          <div class="value" id="metricTotal">0</div>
          <div class="hint">号池内全部账号</div>
        </div>
        <div class="metric" data-motion>
          <div class="label">启用账号</div>
          <div class="value" id="metricEnabled">0</div>
          <div class="hint">参与轮询</div>
        </div>
        <div class="metric" data-motion>
          <div class="label">禁用账号</div>
          <div class="value" id="metricDisabled">0</div>
          <div class="hint">已暂停使用</div>
        </div>
        <div class="metric" data-motion>
          <div class="label">最近延迟</div>
          <div class="value" id="metricLatency">-</div>
          <div class="hint" id="metricAvgLatency">平均 -</div>
        </div>
        <div class="metric" data-motion>
          <div class="label">总请求</div>
          <div class="value" id="metricRequests">0</div>
          <div class="hint" id="metricReqHint">成功 0 / 失败 0</div>
        </div>
        <div class="metric" data-motion>
          <div class="label">NewAPI Base URL</div>
          <div class="value" id="metricBaseUrl" title="-">-</div>
          <div class="hint"><button type="button" class="btn-sm" id="copyBaseInlineBtn">复制地址</button></div>
        </div>
      </section>
    </section>

    <div class="content">
      <section class="panel" data-motion>
        <div class="section-head">
          <h2>账号池</h2>
          <span class="section-note" id="accountPoolNote">正在加载...</span>
        </div>
        <div id="accountPoolLoading" class="loading-overlay hidden">正在刷新账号池...</div>
        <div class="table-wrap">
          <table class="table dense">
            <thead>
              <tr>
                <th>备注</th>
                <th>邮箱</th>
                <th>Subject</th>
                <th>状态</th>
                <th>Access</th>
                <th>Refresh</th>
                <th>过期时间</th>
                <th>成功</th>
                <th>失败</th>
                <th>最后使用</th>
                <th>最后错误</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody id="accountRows">
              <tr><td colspan="12" class="muted">正在读取账号池...</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="ops-grid">
        <div class="panel" data-motion>
          <h2>添加账号</h2>
          <div class="import-tabs">
            <button type="button" class="active" id="importTabSingle">单个 auth.json</button>
            <button type="button" id="importTabBatch">批量 JSON</button>
          </div>
          <div class="field">
            <label for="importLabel">账号备注</label>
            <input id="importLabel" placeholder="例如：主账号 / 备用号" />
          </div>
          <div id="importSinglePane">
            <label for="importAuthJson">粘贴 auth.json（含 accessToken 与 refreshToken）</label>
            <textarea id="importAuthJson" placeholder='{"accessToken":"...","refreshToken":"..."}'></textarea>
          </div>
          <div id="importBatchPane" class="hidden">
            <label for="importBatchJson">批量 JSON</label>
            <textarea id="importBatchJson" placeholder='{"accounts":[{"label":"A","accessToken":"...","refreshToken":"..."}]}'></textarea>
            <div class="hint">支持 <code>{"accounts":[...]}</code> 或直接粘贴 JSON 数组。</div>
          </div>
          <div class="row" style="margin-top: 12px;">
            <button class="primary" id="importBtn">导入账号</button>
          </div>
          <div class="toast" id="importToast" style="margin-top: 10px;"></div>
        </div>

        <div class="panel" data-motion>
          <h2>OAuth 登录</h2>
          <div class="row">
            <button class="primary" id="oauthStartBtn">生成 Cursor OAuth 授权链接</button>
            <button id="oauthOpenBtn" type="button" disabled>打开链接</button>
          </div>
          <div class="field" style="margin-top: 12px;">
            <label for="oauthUrl">授权链接</label>
            <textarea id="oauthUrl" readonly placeholder="点击上方按钮后显示"></textarea>
          </div>
          <div class="field">
            <label for="oauthCallback">回调 URL / 授权完成结果</label>
            <input id="oauthCallback" placeholder="浏览器授权完成后，如有最终跳转地址可粘贴于此" />
          </div>
          <div class="row">
            <button id="oauthCopyBtn" type="button" disabled>复制授权链接</button>
            <button class="primary" id="oauthCheckBtn" type="button">检查授权结果 / 导入账号</button>
          </div>
          <div class="field" style="margin-top: 12px;">
            <label>OAuth 会话状态</label>
            <div class="oauth-box" id="oauthStatusBox">尚未开始 OAuth。</div>
          </div>
          <div class="toast" id="oauthToast" style="margin-top: 10px;"></div>
        </div>
      </section>

      <section class="ops-grid">
        <div class="panel" data-motion>
          <h2>运行诊断</h2>
          <div class="split">
            <div class="field">
              <label for="probeModel">探针模型</label>
              <select id="probeModel">
                <option value="composer-2-fast">composer-2-fast</option>
                <option value="composer-2.5-fast">composer-2.5-fast</option>
                <option value="auto">auto</option>
              </select>
            </div>
            <div class="field">
              <label for="probeAccount">指定账号（可选）</label>
              <select id="probeAccount">
                <option value="">自动轮询启用账号</option>
              </select>
            </div>
          </div>
          <div class="row" style="margin-top: 12px;">
            <button class="primary" id="probeBtn">运行探针</button>
          </div>
          <div class="probe-result" id="probeBox">
            <div class="probe-line">还没有运行探针。</div>
          </div>
        </div>

        <div class="panel" data-motion>
          <h2>NewAPI 接入</h2>
          <div class="copyline" style="margin-bottom: 12px;">
            <input id="baseUrlInput" readonly />
            <button id="copyBaseHeroBtn" type="button">复制</button>
          </div>
          <div class="copyline" style="margin-bottom: 8px;">
            <input id="apiKeyDisplay" class="secret-input" type="password" readonly placeholder="API Key 未配置" />
            <button id="copyApiKeyBtn" type="button">复制 API Key</button>
          </div>
          <div class="secret-hint">API Key 只在点击复制时请求，页面不明文展示。</div>
          <div class="endpoint-list" id="endpointList"></div>
          <h2 style="margin-top: 18px;">模型列表</h2>
          <div class="table-wrap">
            <table class="table dense">
              <thead><tr><th>模型 ID</th><th>上游 ID</th><th>名称</th></tr></thead>
              <tbody id="modelRows"><tr><td colspan="3">正在读取...</td></tr></tbody>
            </table>
          </div>
        </div>
      </section>

      <details class="advanced-panel" data-motion>
        <summary>高级调试信息（默认折叠）</summary>
        <div class="advanced-body stack">
          <div class="field">
            <label>Status JSON</label>
            <textarea id="debugStatus" readonly></textarea>
          </div>
          <div class="field">
            <label>Accounts JSON</label>
            <textarea id="debugAccounts" readonly></textarea>
          </div>
          <div class="field">
            <label>OAuth Session JSON</label>
            <textarea id="debugOAuth" readonly></textarea>
          </div>
        </div>
      </details>
    </div>
  </main>

  <script>
    ${buildAdminClientUtils()}
    const ADMIN_API = '/direct-admin/api';
    const state = {
      password: localStorage.getItem('cursor_direct_admin_password') || '',
      remember: localStorage.getItem('cursor_direct_admin_remember') === '1',
      importMode: 'single',
      oauthUrl: '',
      status: null,
      accountsPayload: null,
      models: [],
      oauthPayload: null,
      clientBaseUrl: '',
      busy: false,
    };
    const $ = (id) => document.getElementById(id);

    function kickoffMotion(root = document) {
      const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const nodes = Array.from(root.querySelectorAll('[data-motion]'));
      nodes.forEach((node, index) => {
        node.classList.remove('css-enter');
        node.style.setProperty('--motion-delay', reduceMotion ? '0ms' : String(Math.min(index * 35, 280)) + 'ms');
        requestAnimationFrame(() => node.classList.add('css-enter'));
      });
    }
    function setLoginVisible(visible) {
      $('loginView').classList.toggle('hidden', !visible);
      $('appView').classList.toggle('hidden', visible);
      requestAnimationFrame(() => kickoffMotion(visible ? $('loginView') : $('appView')));
    }
    function setInlineToast(id, text) {
      const node = $(id);
      if (node) node.textContent = text || '';
    }
    function setBusy(flag) {
      state.busy = flag;
      $('refreshBtn').disabled = flag;
      $('importBtn').disabled = flag;
      $('oauthStartBtn').disabled = flag;
      $('oauthCheckBtn').disabled = flag;
      $('probeBtn').disabled = flag;
      $('copyApiKeyBtn').disabled = flag || !(state.status && state.status.apiKeyConfigured);
      $('accountPoolLoading').classList.toggle('hidden', !flag);
    }
    function authHeaders() {
      return { 'X-Admin-Password': state.password, 'Authorization': 'Bearer ' + state.password };
    }
    async function api(path, options = {}) {
      const headers = Object.assign({}, options.headers || {}, authHeaders());
      const response = await fetch(ADMIN_API + path, {
        method: options.method || 'GET',
        headers,
        body: options.body,
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      if (response.status === 401) throw new Error('管理密码不正确');
      if (!response.ok) {
        const message = data && data.error && data.error.message ? data.error.message : response.statusText;
        throw new Error(message || '请求失败');
      }
      return data;
    }
    function accountLabel(account) {
      return account.label || account.email || account.subject || account.id || '未命名账号';
    }
    function renderStatusBadge(enabled) {
      return enabled
        ? '<span class="badge good">启用</span>'
        : '<span class="badge bad">禁用</span>';
    }
    function renderOverview() {
      const status = state.status || {};
      const pool = state.accountsPayload || {};
      const stats = status.stats || {};
      const apiBasePath = status.apiBasePath || '/v1';
      const configuredPublicBaseUrl = status.config && status.config.publicBaseUrl ? status.publicBaseUrl : '';
      const baseUrl = (configuredPublicBaseUrl || (window.location.origin + apiBasePath)).replace(/\\/+$/, '');
      const healthUrl = baseUrl.endsWith(apiBasePath) ? baseUrl.slice(0, -apiBasePath.length) + '/health' : (window.location.origin + '/health');
      $('runtimeLine').textContent = [
        status.backend || 'direct',
        status.config && status.config.agentHost ? status.config.agentHost : '',
        status.config && status.config.clientVersion ? status.config.clientVersion : '',
      ].filter(Boolean).join(' · ');
      $('healthPill').className = 'pill good';
      $('healthPill').textContent = 'Direct Gateway 正常';
      $('memoryPill').textContent = 'RSS ' + fmtBytes((status.memory && status.memory.rss) || 0);
      $('metricTotal').textContent = String(pool.count || 0);
      $('metricEnabled').textContent = String(pool.enabledCount || 0);
      $('metricDisabled').textContent = String(pool.disabledCount || 0);
      $('metricLatency').textContent = fmtMs(stats.lastDurationMs);
      $('metricAvgLatency').textContent = '平均 ' + fmtMs(stats.averageDurationMs);
      $('metricRequests').textContent = String(stats.totalRequests || 0);
      $('metricReqHint').textContent = '成功 ' + (stats.successRequests || 0) + ' / 失败 ' + (stats.failedRequests || 0);
      const baseNode = $('metricBaseUrl');
      baseNode.textContent = truncateText(baseUrl, 28);
      baseNode.title = baseUrl;
      state.clientBaseUrl = baseUrl;
      $('baseUrlInput').value = baseUrl;
      $('apiKeyDisplay').value = status.apiKeyConfigured ? (status.apiKeyPreview || '已配置，点击复制') : 'API Key 未配置';
      $('copyApiKeyBtn').disabled = !status.apiKeyConfigured;
      $('endpointList').innerHTML = [
        renderEndpoint('GET', healthUrl),
        renderEndpoint('GET', baseUrl + '/models'),
        renderEndpoint('POST', baseUrl + '/chat/completions'),
        renderEndpoint('POST', baseUrl + '/messages'),
      ].join('');
      bindCopyButtons($('endpointList'));
      $('debugStatus').value = JSON.stringify(status, null, 2);
    }
    function renderAccountPool() {
      const pool = state.accountsPayload || {};
      const accounts = Array.isArray(pool.accounts) ? pool.accounts : [];
      $('accountPoolNote').textContent = '共 ' + (pool.count || 0) + ' 个账号，启用 ' + (pool.enabledCount || 0) + ' 个';
      $('debugAccounts').value = JSON.stringify(pool, null, 2);
      if (!accounts.length) {
        $('accountRows').innerHTML = '<tr><td colspan="12"><div class="empty-state">账号池为空。请通过下方导入 auth.json 或使用 OAuth 登录添加账号。</div></td></tr>';
        renderProbeAccounts([]);
        return;
      }
      $('accountRows').innerHTML = accounts.map((account) => {
        const label = escapeHtml(account.label || '-');
        const email = escapeHtml(account.email || '-');
        const subject = escapeHtml(truncateText(account.subject || '-', 24));
        const access = escapeHtml(account.accessTokenPreview || '-');
        const refresh = escapeHtml(account.refreshTokenPreview || '-');
        const lastErr = escapeHtml(truncateText(account.lastError || '-', 32));
        const actions = [
          account.enabled
            ? '<button type="button" class="warn" data-action="disable" data-id="' + escapeHtml(account.id) + '">禁用</button>'
            : '<button type="button" class="primary" data-action="enable" data-id="' + escapeHtml(account.id) + '">启用</button>',
          '<button type="button" data-action="refresh" data-id="' + escapeHtml(account.id) + '">刷新 Token</button>',
          '<button type="button" data-action="probe" data-id="' + escapeHtml(account.id) + '">探针</button>',
          '<button type="button" class="danger" data-action="delete" data-id="' + escapeHtml(account.id) + '">删除</button>',
        ].join('');
        return '<tr>' +
          '<td class="cell-wrap" title="' + label + '">' + label + '</td>' +
          '<td class="cell-wrap" title="' + email + '">' + email + '</td>' +
          '<td class="cell-mono" title="' + escapeHtml(account.subject || '') + '">' + subject + '</td>' +
          '<td>' + renderStatusBadge(account.enabled !== false) + '</td>' +
          '<td class="cell-mono" title="' + access + '">' + access + '</td>' +
          '<td class="cell-mono" title="' + refresh + '">' + refresh + '</td>' +
          '<td>' + escapeHtml(fmtTime(account.accessTokenExpiresAt)) + '</td>' +
          '<td>' + escapeHtml(String(account.successRequests || 0)) + '</td>' +
          '<td>' + escapeHtml(String(account.failedRequests || 0)) + '</td>' +
          '<td>' + escapeHtml(fmtTime(account.lastUsedAt)) + '</td>' +
          '<td class="cell-wrap" title="' + lastErr + '">' + lastErr + '</td>' +
          '<td class="actions-cell">' + actions + '</td>' +
        '</tr>';
      }).join('');
      renderProbeAccounts(accounts);
    }
    function renderProbeAccounts(accounts) {
      const select = $('probeAccount');
      const current = select.value;
      const options = ['<option value="">自动轮询启用账号</option>'].concat(
        accounts.map((account) => {
          const text = accountLabel(account) + (account.enabled === false ? '（已禁用）' : '');
          return '<option value="' + escapeHtml(account.id) + '">' + escapeHtml(text) + '</option>';
        }),
      );
      select.innerHTML = options.join('');
      if (current && accounts.some((item) => item.id === current)) select.value = current;
    }
    function renderModels(models) {
      $('modelPill').textContent = String(models.length) + ' 个模型';
      $('modelRows').innerHTML = models.length
        ? models.map((model) => '<tr><td>' + escapeHtml(model.id) + '</td><td>' + escapeHtml(model.modelId || model.id) + '</td><td>' + escapeHtml(model.displayName || '-') + '</td></tr>').join('')
        : '<tr><td colspan="3">没有模型返回。</td></tr>';
      const preferred = ['composer-2-fast', 'composer-2.5-fast', 'auto'];
      const ids = Array.from(new Set(preferred.concat(models.map((model) => model.id).filter(Boolean))));
      const current = $('probeModel').value || preferred[0];
      $('probeModel').innerHTML = ids.map((id) => '<option value="' + escapeHtml(id) + '">' + escapeHtml(id) + '</option>').join('');
      $('probeModel').value = ids.includes(current) ? current : (ids[0] || 'auto');
    }
    function renderOAuth() {
      const payload = state.oauthPayload || {};
      const session = payload.session || {};
      state.oauthUrl = session.url || state.oauthUrl || '';
      $('oauthUrl').value = state.oauthUrl;
      $('oauthOpenBtn').disabled = !state.oauthUrl;
      $('oauthCopyBtn').disabled = !state.oauthUrl;
      $('oauthStatusBox').textContent = [
        '状态: ' + (session.status || 'idle'),
        '运行中: ' + (session.running ? '是' : '否'),
        'PID: ' + (session.pid || '-'),
        '会话 ID: ' + (session.id || '-'),
        '开始: ' + (session.startedAt ? fmtTime(session.startedAt) : '-'),
        '更新: ' + (session.updatedAt ? fmtTime(session.updatedAt) : '-'),
        '完成: ' + (session.completedAt ? fmtTime(session.completedAt) : '-'),
        '回调: ' + (session.callbackUrl || '-'),
        '错误: ' + (session.error || '-'),
      ].join('\\n');
      $('debugOAuth').value = JSON.stringify(payload, null, 2);
    }
    function renderAll() {
      renderOverview();
      renderAccountPool();
      renderModels(state.models);
      renderOAuth();
    }
    async function refreshAll() {
      setBusy(true);
      try {
        const [status, accountsPayload, oauthPayload] = await Promise.all([
          api('/status'),
          api('/accounts'),
          api('/oauth/session'),
        ]);
        state.status = status;
        state.accountsPayload = accountsPayload;
        state.oauthPayload = oauthPayload;
        let models = [];
        try {
          const modelPayload = await api('/models');
          models = Array.isArray(modelPayload.models) ? modelPayload.models : [];
        } catch (error) {
          $('modelPill').className = 'pill warn';
          $('modelPill').textContent = '模型读取失败';
          $('modelRows').innerHTML = '<tr><td colspan="3">' + escapeHtml(error.message) + '</td></tr>';
        }
        state.models = models;
        renderAll();
        showToast('数据已刷新');
      } finally {
        setBusy(false);
      }
    }
    async function login() {
      state.password = $('adminPassword').value.trim();
      if (!state.password) {
        setInlineToast('loginStatus', '请先输入管理密码。');
        return;
      }
      try {
        await api('/status');
        if (state.remember) {
          localStorage.setItem('cursor_direct_admin_password', state.password);
          localStorage.setItem('cursor_direct_admin_remember', '1');
        } else {
          localStorage.removeItem('cursor_direct_admin_password');
          localStorage.removeItem('cursor_direct_admin_remember');
        }
        setLoginVisible(false);
        await refreshAll();
        setInlineToast('loginStatus', '');
      } catch (error) {
        setInlineToast('loginStatus', error.message);
      }
    }
    function setImportMode(mode) {
      state.importMode = mode;
      $('importTabSingle').classList.toggle('active', mode === 'single');
      $('importTabBatch').classList.toggle('active', mode === 'batch');
      $('importSinglePane').classList.toggle('hidden', mode !== 'single');
      $('importBatchPane').classList.toggle('hidden', mode !== 'batch');
    }
    function buildImportBody() {
      const label = $('importLabel').value.trim();
      if (state.importMode === 'single') {
        const authJson = $('importAuthJson').value.trim();
        if (!authJson) throw new Error('请粘贴 auth.json 内容');
        JSON.parse(authJson);
        return { label: label || undefined, authJson };
      }
      const raw = $('importBatchJson').value.trim();
      if (!raw) throw new Error('请粘贴批量 JSON');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return { accounts: parsed.map((item) => ({ ...item, label: item.label || label || undefined })) };
      if (Array.isArray(parsed.accounts)) {
        return {
          accounts: parsed.accounts.map((item) => ({ ...item, label: item.label || label || undefined })),
        };
      }
      if (parsed.accessToken && parsed.refreshToken) {
        return { accounts: [{ ...parsed, label: parsed.label || label || undefined }] };
      }
      throw new Error('批量 JSON 格式无效，需包含 accounts 数组或 token 对象');
    }
    async function importAccounts() {
      setInlineToast('importToast', '正在导入账号...');
      $('importBtn').disabled = true;
      try {
        const body = buildImportBody();
        const result = await api('/accounts/import', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        $('importAuthJson').value = '';
        $('importBatchJson').value = '';
        $('importLabel').value = '';
        const count = Array.isArray(result.imported) ? result.imported.length : 0;
        setInlineToast('importToast', '导入成功，共 ' + count + ' 个账号。');
        showToast('账号导入成功');
        await refreshAll();
      } catch (error) {
        const message = error instanceof SyntaxError ? 'JSON 格式无效，请检查后重试' : error.message;
        setInlineToast('importToast', '导入失败：' + message);
      } finally {
        $('importBtn').disabled = state.busy;
      }
    }
    async function accountAction(accountId, action) {
      if (action === 'delete') {
        const account = (state.accountsPayload?.accounts || []).find((item) => item.id === accountId);
        const name = account ? accountLabel(account) : accountId;
        if (!confirm('确认删除账号「' + name + '」吗？此操作不可恢复。')) return;
        await api('/accounts/' + encodeURIComponent(accountId), { method: 'DELETE' });
        showToast('账号已删除');
        await refreshAll();
        return;
      }
      if (action === 'enable' || action === 'disable') {
        await api('/accounts/' + encodeURIComponent(accountId) + '/' + action, { method: 'POST' });
        showToast(action === 'enable' ? '账号已启用' : '账号已禁用');
        await refreshAll();
        return;
      }
      if (action === 'refresh') {
        await api('/accounts/' + encodeURIComponent(accountId) + '/refresh-token', { method: 'POST' });
        showToast('Token 刷新完成');
        await refreshAll();
        return;
      }
      if (action === 'probe') {
        $('probeAccount').value = accountId;
        await runProbe();
      }
    }
    async function startOAuth() {
      setInlineToast('oauthToast', '正在生成授权链接...');
      $('oauthStartBtn').disabled = true;
      try {
        const result = await api('/oauth/start', { method: 'POST' });
        state.oauthPayload = { session: result.session || {}, accounts: result.accounts };
        state.oauthUrl = result.session && result.session.url ? result.session.url : '';
        renderOAuth();
        if (state.oauthUrl) await copyText(state.oauthUrl, '授权链接');
        setInlineToast('oauthToast', state.oauthUrl ? '授权链接已生成。' : '会话已创建，等待链接输出。');
        await refreshAll();
      } catch (error) {
        setInlineToast('oauthToast', '生成失败：' + error.message);
      } finally {
        $('oauthStartBtn').disabled = state.busy;
      }
    }
    async function checkOAuth() {
      setInlineToast('oauthToast', '正在检查授权结果...');
      $('oauthCheckBtn').disabled = true;
      try {
        const result = await api('/oauth/callback', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ callbackUrl: $('oauthCallback').value.trim() }),
        });
        state.oauthPayload = { session: result.session || {}, accounts: result.accounts };
        renderOAuth();
        if (result.ok !== false && (result.imported || result.accounts)) {
          setInlineToast('oauthToast', 'OAuth 成功，账号已导入号池。');
          showToast('OAuth 账号已导入');
        } else {
          setInlineToast('oauthToast', '尚未完成授权，请完成浏览器登录后重试。');
        }
        await refreshAll();
      } catch (error) {
        setInlineToast('oauthToast', '检查失败：' + error.message);
      } finally {
        $('oauthCheckBtn').disabled = state.busy;
      }
    }
    function renderProbeResult(lines) {
      $('probeBox').innerHTML = lines.map((line) => '<div class="probe-line">' + line + '</div>').join('');
    }
    async function runProbe() {
      const model = $('probeModel').value || 'composer-2-fast';
      const accountId = $('probeAccount').value || '';
      renderProbeResult(['<strong>状态</strong> 正在请求 ' + escapeHtml(model) + '...']);
      $('probeBtn').disabled = true;
      try {
        const body = { model };
        if (accountId) body.accountId = accountId;
        const result = await api('/probe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const used = result.account ? accountLabel(result.account) : (accountId || '自动轮询');
        renderProbeResult([
          '<strong>模型</strong> ' + escapeHtml(result.model || model),
          '<strong>账号</strong> ' + escapeHtml(used),
          '<strong>耗时</strong> ' + escapeHtml(fmtMs(result.durationMs)),
          '<strong>输出</strong> ' + escapeHtml(result.text || '-'),
        ]);
        await refreshAll();
      } catch (error) {
        renderProbeResult(['<strong>失败</strong> ' + escapeHtml(error.message)]);
      } finally {
        $('probeBtn').disabled = state.busy;
      }
    }
    function resolveBaseUrl() {
      return state.clientBaseUrl || (window.location.origin + '/v1');
    }
    async function copyBaseUrl() {
      const value = resolveBaseUrl();
      await copyText(value, 'Base URL');
    }
    async function copyApiKey() {
      try {
        const result = await api('/client-config');
        if (result && result.apiKeyPreview) $('apiKeyDisplay').value = result.apiKeyPreview;
        if (!result || !result.apiKey) {
          showToast('API Key 未配置');
          return;
        }
        await copyText(result.apiKey, 'API Key');
      } catch (error) {
        showToast('API Key 复制失败：' + error.message);
      }
    }

    $('loginBtn').addEventListener('click', login);
    $('adminPassword').addEventListener('keydown', (event) => { if (event.key === 'Enter') login(); });
    $('rememberBtn').addEventListener('click', () => {
      state.remember = !state.remember;
      $('rememberBtn').textContent = state.remember ? '已记住本浏览器' : '记住本浏览器';
      if (!state.remember) {
        localStorage.removeItem('cursor_direct_admin_password');
        localStorage.removeItem('cursor_direct_admin_remember');
      }
    });
    $('logoutAdminBtn').addEventListener('click', () => {
      localStorage.removeItem('cursor_direct_admin_password');
      localStorage.removeItem('cursor_direct_admin_remember');
      state.password = '';
      $('adminPassword').value = '';
      setLoginVisible(true);
    });
    $('refreshBtn').addEventListener('click', refreshAll);
    $('copyBaseBtn').addEventListener('click', copyBaseUrl);
    $('copyBaseInlineBtn').addEventListener('click', copyBaseUrl);
    $('copyBaseHeroBtn').addEventListener('click', copyBaseUrl);
    $('copyApiKeyBtn').addEventListener('click', copyApiKey);
    $('importTabSingle').addEventListener('click', () => setImportMode('single'));
    $('importTabBatch').addEventListener('click', () => setImportMode('batch'));
    $('importBtn').addEventListener('click', importAccounts);
    $('oauthStartBtn').addEventListener('click', startOAuth);
    $('oauthOpenBtn').addEventListener('click', () => {
      if (state.oauthUrl) window.open(state.oauthUrl, '_blank', 'noopener,noreferrer');
    });
    $('oauthCopyBtn').addEventListener('click', () => copyText(state.oauthUrl, '授权链接'));
    $('oauthCheckBtn').addEventListener('click', checkOAuth);
    $('probeBtn').addEventListener('click', runProbe);
    $('accountRows').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      accountAction(button.getAttribute('data-id'), button.getAttribute('data-action')).catch((error) => {
        showToast('操作失败：' + error.message);
      });
    });

    requestAnimationFrame(() => kickoffMotion($('loginView')));
    if (state.remember && state.password) {
      $('adminPassword').value = state.password;
      login();
    }
  </script>
</body>
</html>`;
}
