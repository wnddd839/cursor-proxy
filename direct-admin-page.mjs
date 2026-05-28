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
        <h1>Cursor Direct Gateway</h1>
      </div>
      <p>输入管理密码后，可在同一页面完成账号池总览、导入、OAuth 登录、探针测试与 NewAPI 接入配置。</p>
      <div class="login-divider">认证</div>
      <div class="field">
        <label for="adminPassword">管理密码</label>
        <input id="adminPassword" type="password" autocomplete="current-password" placeholder="输入管理密码" />
      </div>
      <div class="row" style="margin-top: 16px;">
        <button class="primary" id="loginBtn">进入控制台</button>
        <button class="ghost" id="rememberBtn" type="button">记住本浏览器</button>
      </div>
      <div class="toast-line" id="loginStatus" style="margin-top: 14px;">等待输入管理密码。</div>
      <div class="footerline">
        <span>Cursor Direct Gateway</span>
        <span id="loginYear"></span>
      </div>
    </section>
  </div>

  <header class="topbar hidden" id="topbar" data-motion>
    <div class="brand">
      <span class="brand-name">Cursor Direct Gateway</span>
      <span class="pill good" id="statusIndicator"><span id="statusIndicatorText">运行中</span></span>
    </div>
    <nav class="view-nav" id="viewNav">
      <button type="button" class="view-tab active" data-view="cursor" onclick="setActiveView('cursor')">Cursor Direct</button>
      <button type="button" class="view-tab" data-view="codebuddy" onclick="setActiveView('codebuddy')">CodeBuddy</button>
    </nav>
    <div class="topbar-actions">
      <button id="refreshBtn">刷新全部</button>
      <button class="primary" id="copyBaseBtn">复制 Base URL</button>
      <button class="ghost" id="logoutAdminBtn">退出</button>
    </div>
  </header>

  <main class="shell hidden" id="appView">
    <div id="cursorView">
    <section class="dashboard-header" data-motion>
      <div class="dh-title-row">
        <span class="dh-title">CURSOR DIRECT GATEWAY</span>
        <span class="pill good">运行中</span>
      </div>
      <div class="dh-chips" id="runtimeChips"></div>
    </section>

    <section class="metric-grid" data-motion>
      <div class="metric" data-motion>
        <div class="label">账号总数</div>
        <div class="value" id="metricTotal" data-num="0">0</div>
        <div class="hint">号池内全部账号</div>
      </div>
      <div class="metric" data-motion>
        <div class="label">启用账号</div>
        <div class="value" id="metricEnabled" data-num="0">0</div>
        <div class="hint">参与轮询</div>
      </div>
      <div class="metric" data-motion>
        <div class="label">禁用账号</div>
        <div class="value" id="metricDisabled" data-num="0">0</div>
        <div class="hint">已暂停使用</div>
      </div>
      <div class="metric" data-motion>
        <div class="label">最近延迟</div>
        <div class="value" id="metricLatency">-</div>
        <div class="hint" id="metricAvgLatency">平均 -</div>
      </div>
      <div class="metric" data-motion>
        <div class="label">总请求</div>
        <div class="value" id="metricRequests" data-num="0">0</div>
        <div class="hint" id="metricReqHint">成功 0 / 失败 0</div>
      </div>
      <div class="metric" data-motion>
        <div class="label">NewAPI Base URL</div>
        <div class="value multiline" id="metricBaseUrl" title="-">-</div>
        <div class="hint"><button type="button" class="btn-sm" id="copyBaseInlineBtn">复制地址</button></div>
      </div>
    </section>

    <div class="content">
      <section class="panel" data-motion>
        <div class="section-head">
          <h2>账号池 <span class="h2-tag">POOL</span></h2>
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

      <section class="panel" data-motion>
        <h2>账号导入 <span class="h2-tag">INGEST</span></h2>
        <div class="import-tabs" id="importTabs">
          <button type="button" class="active" data-tab="single">单个 auth.json</button>
          <button type="button" data-tab="batch">批量 JSON</button>
          <button type="button" data-tab="oauth">OAuth 授权</button>
        </div>

        <div id="importPaneSingle" class="import-pane">
          <div class="field">
            <label for="importLabel">账号备注</label>
            <input id="importLabel" placeholder="例如：主账号 / 备用号" />
          </div>
          <div class="field">
            <label for="importAuthJson">粘贴 auth.json（含 accessToken 与 refreshToken）</label>
            <textarea id="importAuthJson" placeholder='{"accessToken":"...","refreshToken":"..."}'></textarea>
          </div>
          <div class="row">
            <button class="primary" id="importBtn">导入账号</button>
          </div>
          <div class="toast-line" id="importToast"></div>
        </div>

        <div id="importPaneBatch" class="import-pane hidden">
          <div class="field">
            <label for="importBatchJson">批量 JSON</label>
            <textarea id="importBatchJson" placeholder='{"accounts":[{"label":"A","accessToken":"...","refreshToken":"..."}]}'></textarea>
          </div>
          <div class="import-hint">支持 <code>{"accounts":[...]}</code> 或直接粘贴 JSON 数组。备注与单个面板共用。</div>
          <div class="row">
            <button class="primary" id="importBatchBtn">批量导入</button>
          </div>
          <div class="toast-line" id="importBatchToast"></div>
        </div>

        <div id="importPaneOAuth" class="import-pane hidden">
          <div class="row">
            <button class="primary" id="oauthStartBtn">生成 Cursor OAuth 授权链接</button>
            <button id="oauthOpenBtn" type="button" disabled>打开链接</button>
            <button id="oauthCopyBtn" type="button" disabled>复制链接</button>
          </div>
          <div class="field">
            <label for="oauthUrl">授权链接</label>
            <textarea id="oauthUrl" readonly placeholder="点击上方按钮后显示"></textarea>
          </div>
          <div class="field">
            <label for="oauthCallback">回调 URL / 授权完成结果</label>
            <input id="oauthCallback" placeholder="浏览器授权完成后，如有最终跳转地址可粘贴于此" />
          </div>
          <div class="row">
            <button class="primary" id="oauthCheckBtn" type="button">检查授权结果 / 导入账号</button>
          </div>
          <div class="field">
            <label>OAuth 会话状态</label>
            <div class="oauth-box" id="oauthStatusBox">尚未开始 OAuth。</div>
          </div>
          <div class="toast-line" id="oauthToast"></div>
        </div>
      </section>

      <section class="panel" data-motion>
        <h2>运行诊断 <span class="h2-tag">PROBE</span></h2>
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
        <div class="row" style="margin-top: 14px;">
          <button class="primary" id="probeBtn">运行探针</button>
        </div>
        <pre class="probe-result" id="probeBox"><span class="probe-line muted">// 还没有运行探针。</span></pre>
      </section>

      <section class="panel" data-motion>
        <h2>NewAPI 接入 <span class="h2-tag">ENDPOINT</span></h2>
        <div class="field">
          <label>Base URL</label>
          <div class="copyline">
            <input id="baseUrlInput" readonly />
            <button id="copyBaseHeroBtn" type="button">复制</button>
          </div>
        </div>
        <div class="field">
          <label>API Key</label>
          <div class="copyline">
            <input id="apiKeyDisplay" class="secret-input" type="password" readonly placeholder="API Key 未配置" />
            <button id="copyApiKeyBtn" type="button">复制 API Key</button>
          </div>
          <div class="secret-hint">API Key 只在点击复制时请求，页面不明文展示。</div>
        </div>
        <div class="field">
          <label>常用端点</label>
          <div class="endpoint-list" id="endpointList"></div>
        </div>
        <div class="field">
          <label>模型列表</label>
          <div class="table-wrap">
            <table class="table dense">
              <thead><tr><th>模型 ID</th><th>上游 ID</th><th>名称</th></tr></thead>
              <tbody id="modelRows"><tr><td colspan="3" class="muted">正在读取...</td></tr></tbody>
            </table>
          </div>
        </div>
      </section>

      <details class="advanced-panel" data-motion>
        <summary>高级调试信息</summary>
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
    </div>

    <div id="codebuddyView" class="hidden">
    <div class="content">
      <section class="panel" id="codebuddyPanel" data-motion>
        <div class="section-head">
          <h2>CodeBuddy Provider <span class="h2-tag">CODEBUDDY</span></h2>
          <div class="row" style="gap: 8px;">
            <span class="pill muted" id="codebuddyConfigPill">未配置</span>
            <span class="pill muted" id="codebuddyAuthPill">未登录</span>
            <button type="button" class="ghost btn-sm" id="codebuddyRefreshBtn">刷新</button>
          </div>
        </div>
        <div id="codebuddyLoading" class="loading-overlay hidden">正在刷新 CodeBuddy 数据...</div>
        <div class="codebuddy-summary" id="codebuddySummary">
          <div class="kv"><span class="kv-label">Provider</span><span class="kv-value" id="codebuddyProvider">codebuddy</span></div>
          <div class="kv"><span class="kv-label">Base URL</span><span class="kv-value mono" id="codebuddyBaseUrl" title="-">-</span></div>
          <div class="kv"><span class="kv-label">默认模型</span><span class="kv-value mono" id="codebuddyDefaultModel">codebuddy/default</span></div>
          <div class="kv"><span class="kv-label">账号池</span><span class="kv-value" id="codebuddyAccountSummary">总计 0 · 启用 0 · 禁用 0</span></div>
        </div>

        <div class="subsection" style="margin-top: 4px; padding-top: 0; border-top: none;">
          <div class="subsection-head">
            <span class="subsection-title">账号池 <span class="tag">ACCOUNTS</span></span>
            <span class="subsection-note" id="codebuddyAccountNote">正在加载...</span>
          </div>
          <div class="table-wrap">
            <table class="table dense">
              <thead>
                <tr>
                  <th>备注</th>
                  <th>类型</th>
                  <th>登录</th>
                  <th>状态</th>
                  <th>Base URL</th>
                  <th>Auth Token</th>
                  <th>API Key</th>
                  <th>Helper</th>
                  <th>成功</th>
                  <th>失败</th>
                  <th>最后使用</th>
                  <th>最后错误</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody id="codebuddyAccountRows">
                <tr><td colspan="13" class="muted">正在读取账号池...</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="subsection">
          <div class="subsection-head">
            <span class="subsection-title">可用模型 <span class="tag">MODELS</span></span>
            <span class="subsection-note" id="codebuddyModelNote">-</span>
          </div>
          <div class="table-wrap">
            <table class="table dense">
              <thead><tr><th>模型 ID</th><th>名称</th><th>工具调用</th><th>图片</th></tr></thead>
              <tbody id="codebuddyModelRows">
                <tr><td colspan="4" class="muted">正在读取模型列表...</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="subsection">
          <div class="subsection-head">
            <span class="subsection-title">导入账号 <span class="tag">INGEST</span></span>
          </div>
          <div class="import-tabs" id="codebuddyImportTabs">
            <button type="button" class="active" data-cb-tab="single">单个账号</button>
            <button type="button" data-cb-tab="batch">批量 JSON</button>
          </div>
          <div id="codebuddyImportSingle" class="import-pane">
            <div class="split">
              <div class="field">
                <label for="cbImportLabel">备注 label</label>
                <input id="cbImportLabel" placeholder="例如：CodeBuddy 主账号" />
              </div>
              <div class="field">
                <label for="cbImportBaseUrl">Base URL（可选）</label>
                <input id="cbImportBaseUrl" placeholder="http://127.0.0.1:8080" />
              </div>
            </div>
            <div class="split">
              <div class="field">
                <label for="cbImportAuthToken">Auth Token</label>
                <input id="cbImportAuthToken" type="password" autocomplete="off" placeholder="authToken" />
              </div>
              <div class="field">
                <label for="cbImportApiKey">API Key</label>
                <input id="cbImportApiKey" type="password" autocomplete="off" placeholder="apiKey" />
              </div>
            </div>
            <div class="split">
              <div class="field">
                <label for="cbImportApiKeyHelper">API Key Helper（命令）</label>
                <input id="cbImportApiKeyHelper" autocomplete="off" placeholder="可选 helper 命令" />
              </div>
              <div class="field">
                <label for="cbImportInternetEnv">Internet Environment</label>
                <input id="cbImportInternetEnv" placeholder="default / corp" />
              </div>
            </div>
            <div class="row" style="margin-top: 12px;">
              <button class="primary" id="cbImportBtn">导入 CodeBuddy 账号</button>
            </div>
            <div class="toast-line" id="cbImportToast"></div>
          </div>
          <div id="codebuddyImportBatch" class="import-pane hidden">
            <div class="field">
              <label for="cbImportBatchJson">批量 JSON</label>
              <textarea id="cbImportBatchJson" placeholder='{"accounts":[{"label":"A","authToken":"...","apiKey":"...","baseUrl":"..."}]}'></textarea>
            </div>
            <div class="import-hint">支持 <code>{"accounts":[...]}</code> 或直接粘贴 JSON 数组。每条至少包含 <code>authToken</code> / <code>apiKey</code> / <code>apiKeyHelper</code> 之一。</div>
            <div class="row">
              <button class="primary" id="cbImportBatchBtn">批量导入</button>
            </div>
            <div class="toast-line" id="cbImportBatchToast"></div>
          </div>
        </div>

        <div class="subsection">
          <div class="subsection-head">
            <span class="subsection-title">探针测试 <span class="tag">PROBE</span></span>
          </div>
          <div class="split">
            <div class="field">
              <label for="cbProbeModel">模型</label>
              <select id="cbProbeModel">
                <option value="codebuddy/default">codebuddy/default</option>
              </select>
            </div>
            <div class="field">
              <label for="cbProbeAccount">账号</label>
              <select id="cbProbeAccount">
                <option value="">自动轮询启用账号</option>
              </select>
            </div>
          </div>
          <div class="row" style="margin-top: 12px;">
            <button class="primary" id="cbProbeBtn">运行 CodeBuddy 探针</button>
          </div>
          <pre class="probe-result" id="cbProbeBox"><span class="probe-line muted">// 还没有运行探针。</span></pre>
        </div>
      </section>
    </div>
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
      lastMetrics: { total: 0, enabled: 0, disabled: 0, requests: 0 },
      hasScanned: false,
      activeView: 'cursor',
      codebuddy: {
        status: null,
        accounts: null,
        models: [],
        importMode: 'single',
        unsupported: false,
      },
    };
    const $ = (id) => document.getElementById(id);

    function kickoffMotion(root = document) {
      const reduce = prefersReducedMotion();
      const nodes = Array.from(root.querySelectorAll('[data-motion]'));
      nodes.forEach((node, index) => {
        node.classList.remove('css-enter');
        node.style.setProperty('--motion-delay', reduce ? '0ms' : String(Math.min(index * 60, 600)) + 'ms');
        requestAnimationFrame(() => node.classList.add('css-enter'));
      });
    }
    function triggerScanLine() {
      state.hasScanned = true;
    }
    function setLoginVisible(visible) {
      $('loginView').classList.toggle('hidden', !visible);
      $('appView').classList.toggle('hidden', visible);
      $('topbar').classList.toggle('hidden', visible);
      requestAnimationFrame(() => {
        kickoffMotion(visible ? $('loginView') : document);
        if (!visible) triggerScanLine();
      });
    }
    function setInlineToast(id, text) {
      const node = $(id);
      if (node) node.textContent = text || '';
    }
    function setBusy(flag) {
      state.busy = flag;
      $('refreshBtn').disabled = flag;
      $('importBtn').disabled = flag;
      $('importBatchBtn').disabled = flag;
      $('oauthStartBtn').disabled = flag;
      $('oauthCheckBtn').disabled = flag;
      $('probeBtn').disabled = flag;
      $('copyApiKeyBtn').disabled = flag || !(state.status && state.status.apiKeyConfigured);
      $('accountPoolLoading').classList.toggle('hidden', !flag);
      const cbRefresh = $('codebuddyRefreshBtn');
      if (cbRefresh) cbRefresh.disabled = flag;
      const cbImportBtn = $('cbImportBtn');
      if (cbImportBtn) cbImportBtn.disabled = flag;
      const cbImportBatchBtn = $('cbImportBatchBtn');
      if (cbImportBatchBtn) cbImportBatchBtn.disabled = flag;
      const cbProbeBtn = $('cbProbeBtn');
      if (cbProbeBtn) cbProbeBtn.disabled = flag;
      const cbLoading = $('codebuddyLoading');
      if (cbLoading) cbLoading.classList.toggle('hidden', !flag);
    }
    function setActiveView(view, options) {
      const opts = options || {};
      if (view !== 'cursor' && view !== 'codebuddy') view = 'cursor';
      state.activeView = view;
      if (!opts.skipHash) {
        try { history.replaceState(null, '', '#' + view); } catch (_e) {}
      }
      const cursorView = document.getElementById('cursorView');
      const codebuddyView = document.getElementById('codebuddyView');
      if (cursorView) cursorView.classList.toggle('hidden', view !== 'cursor');
      if (codebuddyView) codebuddyView.classList.toggle('hidden', view !== 'codebuddy');
      document.querySelectorAll('.view-tab').forEach((tab) => {
        tab.classList.toggle('active', tab.getAttribute('data-view') === view);
      });
      if (!opts.skipRefresh) {
        if (view === 'cursor') {
          refreshAll(true).catch(() => {});
        } else {
          refreshCodeBuddy(true).catch(() => {});
        }
      }
    }
    window.setActiveView = setActiveView;
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
        const error = new Error(message || '请求失败');
        error.status = response.status;
        error.data = data;
        throw error;
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
    function setMetric(id, target, animate) {
      const el = $(id);
      if (!el) return;
      const key = id.replace('metric', '').toLowerCase();
      const prev = (state.lastMetrics && key in state.lastMetrics) ? state.lastMetrics[key] : 0;
      if (animate) {
        animateValue(el, prev, target, 700);
      } else {
        el.textContent = String(target);
      }
      if (state.lastMetrics) state.lastMetrics[key] = target;
    }
    function renderRuntimeChips(status) {
      const cfg = (status && status.config) || {};
      const stats = (status && status.stats) || {};
      const mem = (status && status.memory) || {};
      const pool = state.accountsPayload || {};
      const chips = [];
      chips.push(renderChip('Backend', status && status.backend ? status.backend : 'direct', 'good'));
      if (cfg.agentHost) chips.push(renderChip('Agent', cfg.agentHost));
      if (cfg.clientVersion) chips.push(renderChip('Client', cfg.clientVersion));
      chips.push(renderChip('启用账号', String(pool.enabledCount || 0), (pool.enabledCount || 0) > 0 ? 'good' : 'warn'));
      chips.push(renderChip('最近延迟', fmtMs(stats.lastDurationMs)));
      chips.push(renderChip('RSS', fmtBytes(mem.rss || 0)));
      $('runtimeChips').innerHTML = chips.join('');
    }
    function renderOverview() {
      const status = state.status || {};
      const pool = state.accountsPayload || {};
      const stats = status.stats || {};
      const apiBasePath = status.apiBasePath || '/v1';
      const configuredPublicBaseUrl = status.config && status.config.publicBaseUrl ? status.publicBaseUrl : '';
      const baseUrl = (configuredPublicBaseUrl || (window.location.origin + apiBasePath)).replace(/\\/+$/, '');
      const healthUrl = baseUrl.endsWith(apiBasePath) ? baseUrl.slice(0, -apiBasePath.length) + '/health' : (window.location.origin + '/health');
      $('statusIndicatorText').textContent = '运行中';
      renderRuntimeChips(status);

      setMetric('metricTotal', pool.count || 0, true);
      setMetric('metricEnabled', pool.enabledCount || 0, true);
      setMetric('metricDisabled', pool.disabledCount || 0, true);
      setMetric('metricRequests', stats.totalRequests || 0, true);
      $('metricLatency').textContent = fmtMs(stats.lastDurationMs);
      $('metricAvgLatency').textContent = '平均 ' + fmtMs(stats.averageDurationMs);
      $('metricReqHint').textContent = '成功 ' + (stats.successRequests || 0) + ' / 失败 ' + (stats.failedRequests || 0);

      const baseNode = $('metricBaseUrl');
      baseNode.textContent = baseUrl;
      baseNode.title = baseUrl;
      state.clientBaseUrl = baseUrl;
      $('baseUrlInput').value = baseUrl;
      $('apiKeyDisplay').value = status.apiKeyConfigured ? (status.apiKeyPreview || '已配置 · 点击复制') : '';
      $('apiKeyDisplay').placeholder = status.apiKeyConfigured ? '' : 'API Key 未配置';
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
      $('accountPoolNote').textContent = '共 ' + (pool.count || 0) + ' 个账号 · 启用 ' + (pool.enabledCount || 0) + ' · 禁用 ' + (pool.disabledCount || 0);
      $('debugAccounts').value = JSON.stringify(pool, null, 2);
      if (!accounts.length) {
        $('accountRows').innerHTML = '<tr><td colspan="12"><div class="empty-state">// 账号池为空。请通过下方「账号导入」面板添加账号。</div></td></tr>';
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
          '<button type="button" data-action="refresh" data-id="' + escapeHtml(account.id) + '">刷新</button>',
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
      $('modelRows').innerHTML = models.length
        ? models.map((model) => '<tr><td class="cell-mono">' + escapeHtml(model.id) + '</td><td class="cell-mono">' + escapeHtml(model.modelId || model.id) + '</td><td>' + escapeHtml(model.displayName || '-') + '</td></tr>').join('')
        : '<tr><td colspan="3" class="muted">没有模型返回。</td></tr>';
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
      renderCodeBuddy();
    }
    function codeBuddyAuthTypeLabel(type) {
      switch (type) {
        case 'api_key': return 'API Key';
        case 'auth_token': return 'Auth Token';
        case 'api_key_helper': return 'Helper';
        default: return type || '-';
      }
    }
    function codeBuddyLoggedInPill(value) {
      if (value === true) return '<span class="pill good">是</span>';
      if (value === false) return '<span class="pill bad">否</span>';
      return '<span class="pill muted">未知</span>';
    }
    function codeBuddyBoolMark(value) {
      if (value === true) return '<span class="pill good">✓</span>';
      if (value === false) return '<span class="pill muted">–</span>';
      return '<span class="pill muted">?</span>';
    }
    function codeBuddyAccountLabel(account) {
      return account?.label || account?.userName || account?.userNickname || account?.id || '未命名账号';
    }
    function setCodeBuddyImportMode(mode) {
      state.codebuddy.importMode = mode;
      const tabs = $('codebuddyImportTabs');
      if (tabs) {
        tabs.querySelectorAll('button[data-cb-tab]').forEach((btn) => {
          btn.classList.toggle('active', btn.getAttribute('data-cb-tab') === mode);
        });
      }
      $('codebuddyImportSingle').classList.toggle('hidden', mode !== 'single');
      $('codebuddyImportBatch').classList.toggle('hidden', mode !== 'batch');
    }
    function renderCodeBuddySummary() {
      const status = state.codebuddy.status || {};
      const pool = (state.codebuddy.accounts && typeof state.codebuddy.accounts === 'object')
        ? state.codebuddy.accounts
        : (status.accounts && typeof status.accounts === 'object' ? status.accounts : {});
      const unsupported = Boolean(state.codebuddy.unsupported || status.unsupported);
      const configured = !unsupported && Boolean(status && (status.configured === true || status.baseUrl));
      const baseUrl = status.baseUrl || '-';
      const models = Array.isArray(state.codebuddy.models) && state.codebuddy.models.length
        ? state.codebuddy.models
        : (Array.isArray(status.models) ? status.models : []);
      const defaultModel = (models[0] && (models[0].id || models[0].modelId)) || 'codebuddy/default';

      const configPill = $('codebuddyConfigPill');
      configPill.textContent = unsupported ? '未接入' : (configured ? '已配置' : '未配置');
      configPill.className = 'pill ' + (unsupported ? 'warn' : (configured ? 'good' : 'muted'));

      const authPill = $('codebuddyAuthPill');
      const loggedIn = pool && typeof pool.loggedIn === 'boolean' ? pool.loggedIn : null;
      if (unsupported) {
        authPill.textContent = '接口未启用';
        authPill.className = 'pill muted';
      } else if (loggedIn === true) {
        authPill.textContent = '已登录';
        authPill.className = 'pill good';
      } else if (loggedIn === false) {
        authPill.textContent = '未登录';
        authPill.className = 'pill warn';
      } else {
        authPill.textContent = '状态未知';
        authPill.className = 'pill muted';
      }

      $('codebuddyProvider').textContent = status.provider || 'codebuddy';
      const baseNode = $('codebuddyBaseUrl');
      baseNode.textContent = baseUrl;
      baseNode.title = baseUrl;
      $('codebuddyDefaultModel').textContent = defaultModel;

      const total = pool.count || 0;
      const enabled = pool.enabledCount || 0;
      const disabled = pool.disabledCount || (total - enabled) || 0;
      $('codebuddyAccountSummary').textContent = '总计 ' + total + ' · 启用 ' + enabled + ' · 禁用 ' + disabled;
      $('codebuddyAccountNote').textContent = unsupported
        ? '后端 CodeBuddy 管理接口未启用'
        : total
        ? ('共 ' + total + ' 个账号 · 启用 ' + enabled + ' · 禁用 ' + disabled)
        : '账号池为空';
    }
    function renderCodeBuddyAccounts() {
      const pool = (state.codebuddy.accounts && typeof state.codebuddy.accounts === 'object') ? state.codebuddy.accounts : {};
      const accounts = Array.isArray(pool.accounts) ? pool.accounts : [];
      const tbody = $('codebuddyAccountRows');
      if (!tbody) return;
      if (state.codebuddy.unsupported) {
        tbody.innerHTML = '<tr><td colspan="13"><div class="empty-state">// CodeBuddy 后端管理接口尚未启用。当前仅保留前端视图入口。</div></td></tr>';
        renderCodeBuddyProbeAccounts([]);
        return;
      }
      if (!accounts.length) {
        tbody.innerHTML = '<tr><td colspan="13"><div class="empty-state">// 账号池为空。请使用下方「导入账号」面板添加。</div></td></tr>';
      } else {
        tbody.innerHTML = accounts.map((account) => {
          const id = escapeHtml(account.id || '');
          const label = escapeHtml(account.label || '-');
          const authType = escapeHtml(codeBuddyAuthTypeLabel(account.authType));
          const baseUrl = escapeHtml(account.baseUrl || '-');
          const tokenPreview = escapeHtml(account.authTokenPreview || '-');
          const apiKeyPreview = escapeHtml(account.apiKeyPreview || '-');
          const helperPreview = escapeHtml(account.apiKeyHelperPreview || '-');
          const lastErr = escapeHtml(truncateText(account.lastError || '-', 32));
          const enabled = account.enabled !== false;
          const actions = [
            enabled
              ? '<button type="button" class="warn" data-cb-action="disable" data-id="' + id + '">禁用</button>'
              : '<button type="button" class="primary" data-cb-action="enable" data-id="' + id + '">启用</button>',
            '<button type="button" data-cb-action="probe" data-id="' + id + '">探针</button>',
            '<button type="button" class="danger" data-cb-action="delete" data-id="' + id + '">删除</button>',
          ].join('');
          return '<tr>' +
            '<td class="cell-wrap" title="' + label + '">' + label + '</td>' +
            '<td>' + authType + '</td>' +
            '<td>' + codeBuddyLoggedInPill(account.loggedIn) + '</td>' +
            '<td>' + renderStatusBadge(enabled) + '</td>' +
            '<td class="cell-mono" title="' + baseUrl + '">' + baseUrl + '</td>' +
            '<td class="cell-mono" title="' + tokenPreview + '">' + tokenPreview + '</td>' +
            '<td class="cell-mono" title="' + apiKeyPreview + '">' + apiKeyPreview + '</td>' +
            '<td class="cell-mono" title="' + helperPreview + '">' + helperPreview + '</td>' +
            '<td>' + escapeHtml(String(account.successRequests || 0)) + '</td>' +
            '<td>' + escapeHtml(String(account.failedRequests || 0)) + '</td>' +
            '<td>' + escapeHtml(fmtTime(account.lastUsedAt)) + '</td>' +
            '<td class="cell-wrap" title="' + lastErr + '">' + lastErr + '</td>' +
            '<td class="actions-cell">' + actions + '</td>' +
          '</tr>';
        }).join('');
      }
      renderCodeBuddyProbeAccounts(accounts);
    }
    function renderCodeBuddyProbeAccounts(accounts) {
      const select = $('cbProbeAccount');
      if (!select) return;
      const current = select.value;
      const options = ['<option value="">自动轮询启用账号</option>'].concat(
        (accounts || []).map((account) => {
          const text = codeBuddyAccountLabel(account) + (account.enabled === false ? '（已禁用）' : '');
          return '<option value="' + escapeHtml(account.id || '') + '">' + escapeHtml(text) + '</option>';
        }),
      );
      select.innerHTML = options.join('');
      if (current && (accounts || []).some((item) => item.id === current)) select.value = current;
    }
    function renderCodeBuddyModels() {
      const tbody = $('codebuddyModelRows');
      if (!tbody) return;
      const status = state.codebuddy.status || {};
      if (state.codebuddy.unsupported) {
        tbody.innerHTML = '<tr><td colspan="4"><div class="empty-state">// CodeBuddy 后端模型接口尚未启用。</div></td></tr>';
        $('codebuddyModelNote').textContent = '接口未启用';
        return;
      }
      const models = Array.isArray(state.codebuddy.models) && state.codebuddy.models.length
        ? state.codebuddy.models
        : (Array.isArray(status.models) ? status.models : []);
      if (!models.length) {
        tbody.innerHTML = '<tr><td colspan="4"><div class="empty-state">// 未返回模型。默认使用 codebuddy/default。</div></td></tr>';
        $('codebuddyModelNote').textContent = '共 0 个模型';
      } else {
        tbody.innerHTML = models.map((model) => {
          const id = escapeHtml(model.id || model.modelId || '-');
          const name = escapeHtml(model.name || model.displayName || model.id || '-');
          const tools = codeBuddyBoolMark(model.supportsTools);
          const images = codeBuddyBoolMark(model.supportsImages);
          return '<tr>' +
            '<td class="cell-mono" title="' + id + '">' + id + '</td>' +
            '<td>' + name + '</td>' +
            '<td>' + tools + '</td>' +
            '<td>' + images + '</td>' +
          '</tr>';
        }).join('');
        $('codebuddyModelNote').textContent = '共 ' + models.length + ' 个模型';
      }
      const select = $('cbProbeModel');
      if (select) {
        const current = select.value;
        const ids = Array.from(new Set(['codebuddy/default'].concat((models || []).map((m) => m.id || m.modelId).filter(Boolean))));
        select.innerHTML = ids.map((id) => '<option value="' + escapeHtml(id) + '">' + escapeHtml(id) + '</option>').join('');
        select.value = ids.includes(current) ? current : (ids[0] || 'codebuddy/default');
      }
    }
    function renderCodeBuddy() {
      renderCodeBuddySummary();
      renderCodeBuddyAccounts();
      renderCodeBuddyModels();
    }
    async function loadCodeBuddyModels() {
      if (state.codebuddy.unsupported) {
        state.codebuddy.models = [];
        return;
      }
      try {
        const payload = await api('/codebuddy/models');
        if (payload && payload.ok && Array.isArray(payload.models)) {
          state.codebuddy.models = payload.models;
        } else {
          state.codebuddy.models = [];
        }
      } catch (error) {
        state.codebuddy.models = [];
        const tbody = $('codebuddyModelRows');
        if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="muted">' + escapeHtml(error.message) + '</td></tr>';
      }
    }
    async function refreshCodeBuddy(silent) {
      try {
        const statusRes = await api('/codebuddy/status').catch((error) => ({ __error: error }));
        if (statusRes && statusRes.__error && statusRes.__error.status === 404) {
          state.codebuddy.unsupported = true;
          state.codebuddy.status = { provider: 'codebuddy', unsupported: true };
          state.codebuddy.accounts = { count: 0, enabledCount: 0, disabledCount: 0, accounts: [] };
          state.codebuddy.models = [];
          renderCodeBuddy();
          if (!silent) showToast('CodeBuddy 后端管理接口未启用', 'info');
          return;
        }
        if (statusRes && statusRes.__error) throw statusRes.__error;
        state.codebuddy.unsupported = false;
        state.codebuddy.status = statusRes;
        const accountsRes = await api('/codebuddy/accounts').catch((error) => ({ __error: error }));
        if (accountsRes && accountsRes.__error) throw accountsRes.__error;
        state.codebuddy.accounts = accountsRes;
        await loadCodeBuddyModels();
        renderCodeBuddy();
      } catch (error) {
        if (!silent) showToast('CodeBuddy 加载失败：' + error.message, 'error');
      }
    }
    function buildCodeBuddyImportBody(mode) {
      if (mode === 'batch') {
        const raw = ($('cbImportBatchJson').value || '').trim();
        if (!raw) throw new Error('请粘贴批量 JSON');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return { accounts: parsed };
        if (parsed && Array.isArray(parsed.accounts)) return { accounts: parsed.accounts };
        if (parsed && (parsed.authToken || parsed.apiKey || parsed.apiKeyHelper)) return { accounts: [parsed] };
        throw new Error('批量 JSON 格式无效，需包含 accounts 数组或单个凭证对象');
      }
      const label = ($('cbImportLabel').value || '').trim();
      const authToken = ($('cbImportAuthToken').value || '').trim();
      const apiKey = ($('cbImportApiKey').value || '').trim();
      const apiKeyHelper = ($('cbImportApiKeyHelper').value || '').trim();
      const baseUrl = ($('cbImportBaseUrl').value || '').trim();
      const internetEnvironment = ($('cbImportInternetEnv').value || '').trim();
      if (!authToken && !apiKey && !apiKeyHelper) {
        throw new Error('authToken / apiKey / apiKeyHelper 至少填写一项');
      }
      const account = { label: label || undefined };
      if (authToken) account.authToken = authToken;
      if (apiKey) account.apiKey = apiKey;
      if (apiKeyHelper) account.apiKeyHelper = apiKeyHelper;
      if (baseUrl) account.baseUrl = baseUrl;
      if (internetEnvironment) account.internetEnvironment = internetEnvironment;
      return { accounts: [account] };
    }
    async function importCodeBuddyAccounts(mode) {
      const toastId = mode === 'batch' ? 'cbImportBatchToast' : 'cbImportToast';
      const btnId = mode === 'batch' ? 'cbImportBatchBtn' : 'cbImportBtn';
      setInlineToast(toastId, '// 正在导入账号...');
      $(btnId).disabled = true;
      try {
        const body = buildCodeBuddyImportBody(mode);
        const result = await api('/codebuddy/accounts/import', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (mode === 'batch') {
          $('cbImportBatchJson').value = '';
        } else {
          ['cbImportLabel', 'cbImportAuthToken', 'cbImportApiKey', 'cbImportApiKeyHelper', 'cbImportBaseUrl', 'cbImportInternetEnv']
            .forEach((id) => { const node = $(id); if (node) node.value = ''; });
        }
        const count = Array.isArray(result.imported) ? result.imported.length : 0;
        setInlineToast(toastId, '✓ 导入成功，共 ' + count + ' 个账号。');
        showToast('CodeBuddy 账号导入成功 · ' + count + ' 个', 'success');
        await refreshCodeBuddy(true);
      } catch (error) {
        const message = error instanceof SyntaxError ? 'JSON 格式无效，请检查后重试' : error.message;
        setInlineToast(toastId, '✗ 导入失败：' + message);
        showToast('CodeBuddy 导入失败：' + message, 'error');
      } finally {
        $(btnId).disabled = state.busy;
      }
    }
    async function codeBuddyAccountAction(accountId, action) {
      const accounts = (state.codebuddy.accounts && Array.isArray(state.codebuddy.accounts.accounts))
        ? state.codebuddy.accounts.accounts : [];
      const account = accounts.find((item) => item.id === accountId);
      if (action === 'delete') {
        const name = account ? codeBuddyAccountLabel(account) : accountId;
        if (!confirm('确认删除 CodeBuddy 账号「' + name + '」吗？此操作不可恢复。')) return;
        await api('/codebuddy/accounts/' + encodeURIComponent(accountId), { method: 'DELETE' });
        showToast('CodeBuddy 账号已删除', 'success');
        await refreshCodeBuddy(true);
        return;
      }
      if (action === 'enable' || action === 'disable') {
        await api('/codebuddy/accounts/' + encodeURIComponent(accountId) + '/' + action, { method: 'POST' });
        showToast(action === 'enable' ? 'CodeBuddy 账号已启用' : 'CodeBuddy 账号已禁用', 'success');
        await refreshCodeBuddy(true);
        return;
      }
      if (action === 'probe') {
        const select = $('cbProbeAccount');
        if (select) select.value = accountId;
        await runCodeBuddyProbe();
      }
    }
    function renderCodeBuddyProbeResult(lines, variant) {
      const box = $('cbProbeBox');
      if (!box) return;
      box.classList.remove('ok', 'fail');
      if (variant) box.classList.add(variant);
      box.innerHTML = lines.map((line) => '<div class="probe-line">' + line + '</div>').join('');
    }
    async function runCodeBuddyProbe() {
      const model = ($('cbProbeModel').value || '').trim() || 'codebuddy/default';
      const accountId = ($('cbProbeAccount').value || '').trim();
      renderCodeBuddyProbeResult(['<strong>状态</strong> 正在请求 ' + escapeHtml(model) + '...'], '');
      $('cbProbeBtn').disabled = true;
      try {
        const body = { model };
        if (accountId) body.accountId = accountId;
        const result = await api('/codebuddy/probe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const used = result.account ? codeBuddyAccountLabel(result.account) : (accountId || '自动轮询');
        renderCodeBuddyProbeResult([
          '<strong>模型</strong> ' + escapeHtml(result.model || model),
          '<strong>账号</strong> ' + escapeHtml(used),
          '<strong>耗时</strong> ' + escapeHtml(fmtMs(result.durationMs)),
          '<strong>输出</strong> ' + escapeHtml(result.text || '-'),
        ], 'ok');
        showToast('CodeBuddy 探针完成 · ' + fmtMs(result.durationMs), 'success');
        await refreshCodeBuddy(true);
      } catch (error) {
        renderCodeBuddyProbeResult([
          '<strong>状态</strong> 失败',
          '<strong>错误</strong> ' + escapeHtml(error.message),
        ], 'fail');
        showToast('CodeBuddy 探针失败：' + error.message, 'error');
      } finally {
        $('cbProbeBtn').disabled = state.busy;
      }
    }
    async function refreshAll(silent) {
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
          $('modelRows').innerHTML = '<tr><td colspan="3" class="muted">' + escapeHtml(error.message) + '</td></tr>';
        }
        state.models = models;
        renderAll();
        if (!silent) showToast('数据已刷新', 'success');
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
        const initialHash = (location.hash || '').replace('#', '');
        const initialView = (initialHash === 'codebuddy') ? 'codebuddy' : 'cursor';
        setActiveView(initialView, { skipRefresh: true, skipHash: !initialHash });
        await refreshAll(true);
        if (initialView === 'codebuddy') await refreshCodeBuddy(true);
        setInlineToast('loginStatus', '');
        showToast('已进入控制台', 'success');
      } catch (error) {
        setInlineToast('loginStatus', error.message);
        showToast('登录失败：' + error.message, 'error');
      }
    }
    function setImportMode(mode) {
      state.importMode = mode;
      $('importTabs').querySelectorAll('button').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === mode);
      });
      $('importPaneSingle').classList.toggle('hidden', mode !== 'single');
      $('importPaneBatch').classList.toggle('hidden', mode !== 'batch');
      $('importPaneOAuth').classList.toggle('hidden', mode !== 'oauth');
    }
    function buildImportBody(mode) {
      const label = $('importLabel').value.trim();
      if (mode === 'single') {
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
        return { accounts: parsed.accounts.map((item) => ({ ...item, label: item.label || label || undefined })) };
      }
      if (parsed.accessToken && parsed.refreshToken) {
        return { accounts: [{ ...parsed, label: parsed.label || label || undefined }] };
      }
      throw new Error('批量 JSON 格式无效，需包含 accounts 数组或 token 对象');
    }
    async function importAccounts(mode) {
      const toastId = mode === 'batch' ? 'importBatchToast' : 'importToast';
      const btnId = mode === 'batch' ? 'importBatchBtn' : 'importBtn';
      setInlineToast(toastId, '// 正在导入账号...');
      $(btnId).disabled = true;
      try {
        const body = buildImportBody(mode);
        const result = await api('/accounts/import', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        $('importAuthJson').value = '';
        $('importBatchJson').value = '';
        $('importLabel').value = '';
        const count = Array.isArray(result.imported) ? result.imported.length : 0;
        setInlineToast(toastId, '✓ 导入成功，共 ' + count + ' 个账号。');
        showToast('账号导入成功 · ' + count + ' 个', 'success');
        await refreshAll(true);
      } catch (error) {
        const message = error instanceof SyntaxError ? 'JSON 格式无效，请检查后重试' : error.message;
        setInlineToast(toastId, '✗ 导入失败：' + message);
        showToast('导入失败：' + message, 'error');
      } finally {
        $(btnId).disabled = state.busy;
      }
    }
    async function accountAction(accountId, action) {
      if (action === 'delete') {
        const account = (state.accountsPayload?.accounts || []).find((item) => item.id === accountId);
        const name = account ? accountLabel(account) : accountId;
        if (!confirm('确认删除账号「' + name + '」吗？此操作不可恢复。')) return;
        await api('/accounts/' + encodeURIComponent(accountId), { method: 'DELETE' });
        showToast('账号已删除', 'success');
        await refreshAll(true);
        return;
      }
      if (action === 'enable' || action === 'disable') {
        await api('/accounts/' + encodeURIComponent(accountId) + '/' + action, { method: 'POST' });
        showToast(action === 'enable' ? '账号已启用' : '账号已禁用', 'success');
        await refreshAll(true);
        return;
      }
      if (action === 'refresh') {
        await api('/accounts/' + encodeURIComponent(accountId) + '/refresh-token', { method: 'POST' });
        showToast('Token 刷新完成', 'success');
        await refreshAll(true);
        return;
      }
      if (action === 'probe') {
        $('probeAccount').value = accountId;
        await runProbe();
      }
    }
    async function startOAuth() {
      setInlineToast('oauthToast', '// 正在生成授权链接...');
      $('oauthStartBtn').disabled = true;
      try {
        const result = await api('/oauth/start', { method: 'POST' });
        state.oauthPayload = { session: result.session || {}, accounts: result.accounts };
        state.oauthUrl = result.session && result.session.url ? result.session.url : '';
        renderOAuth();
        if (state.oauthUrl) await copyText(state.oauthUrl, '授权链接');
        setInlineToast('oauthToast', state.oauthUrl ? '✓ 授权链接已生成。' : '会话已创建，等待链接输出。');
        await refreshAll(true);
      } catch (error) {
        setInlineToast('oauthToast', '✗ 生成失败：' + error.message);
        showToast('OAuth 失败：' + error.message, 'error');
      } finally {
        $('oauthStartBtn').disabled = state.busy;
      }
    }
    async function checkOAuth() {
      setInlineToast('oauthToast', '// 正在检查授权结果...');
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
          setInlineToast('oauthToast', '✓ OAuth 成功，账号已导入号池。');
          showToast('OAuth 账号已导入', 'success');
        } else {
          setInlineToast('oauthToast', '尚未完成授权，请完成浏览器登录后重试。');
        }
        await refreshAll(true);
      } catch (error) {
        setInlineToast('oauthToast', '✗ 检查失败：' + error.message);
        showToast('检查失败：' + error.message, 'error');
      } finally {
        $('oauthCheckBtn').disabled = state.busy;
      }
    }
    function renderProbeResult(lines, variant) {
      const box = $('probeBox');
      box.classList.remove('ok', 'fail');
      if (variant) box.classList.add(variant);
      box.innerHTML = lines.map((line) => '<div class="probe-line">' + line + '</div>').join('');
    }
    async function runProbe() {
      const model = $('probeModel').value || 'composer-2-fast';
      const accountId = $('probeAccount').value || '';
      renderProbeResult(['<strong>状态</strong> 正在请求 ' + escapeHtml(model) + '...'], '');
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
        ], 'ok');
        showToast('探针完成 · ' + fmtMs(result.durationMs), 'success');
        await refreshAll(true);
      } catch (error) {
        renderProbeResult([
          '<strong>状态</strong> 失败',
          '<strong>错误</strong> ' + escapeHtml(error.message),
        ], 'fail');
        showToast('探针失败：' + error.message, 'error');
      } finally {
        $('probeBtn').disabled = state.busy;
      }
    }
    function resolveBaseUrl() {
      return state.clientBaseUrl || (window.location.origin + '/v1');
    }
    async function copyBaseUrl(button) {
      const value = resolveBaseUrl();
      await copyText(value, 'Base URL', button instanceof HTMLElement ? button : undefined);
    }
    async function copyApiKey(button) {
      try {
        const result = await api('/client-config');
        if (result && result.apiKeyPreview) $('apiKeyDisplay').value = result.apiKeyPreview;
        if (!result || !result.apiKey) {
          showToast('API Key 未配置', 'error');
          return;
        }
        await copyText(result.apiKey, 'API Key', button instanceof HTMLElement ? button : undefined);
      } catch (error) {
        showToast('API Key 复制失败：' + error.message, 'error');
      }
    }

    $('loginYear').textContent = String(new Date().getFullYear());
    $('rememberBtn').textContent = state.remember ? '已记住本浏览器' : '记住本浏览器';
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
      state.hasScanned = false;
      setLoginVisible(true);
    });
    $('refreshBtn').addEventListener('click', () => refreshAll(false));
    $('copyBaseBtn').addEventListener('click', (e) => copyBaseUrl(e.currentTarget));
    $('copyBaseInlineBtn').addEventListener('click', (e) => copyBaseUrl(e.currentTarget));
    $('copyBaseHeroBtn').addEventListener('click', (e) => copyBaseUrl(e.currentTarget));
    $('copyApiKeyBtn').addEventListener('click', (e) => copyApiKey(e.currentTarget));
    $('importTabs').addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-tab]');
      if (btn) setImportMode(btn.getAttribute('data-tab'));
    });
    $('importBtn').addEventListener('click', () => importAccounts('single'));
    $('importBatchBtn').addEventListener('click', () => importAccounts('batch'));
    $('oauthStartBtn').addEventListener('click', startOAuth);
    $('oauthOpenBtn').addEventListener('click', () => {
      if (state.oauthUrl) window.open(state.oauthUrl, '_blank', 'noopener,noreferrer');
    });
    $('oauthCopyBtn').addEventListener('click', (e) => copyText(state.oauthUrl, '授权链接', e.currentTarget));
    $('oauthCheckBtn').addEventListener('click', checkOAuth);
    $('probeBtn').addEventListener('click', runProbe);
    $('accountRows').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      accountAction(button.getAttribute('data-id'), button.getAttribute('data-action')).catch((error) => {
        showToast('操作失败：' + error.message, 'error');
      });
    });
    const cbImportTabs = $('codebuddyImportTabs');
    if (cbImportTabs) {
      cbImportTabs.addEventListener('click', (event) => {
        const btn = event.target.closest('button[data-cb-tab]');
        if (btn) setCodeBuddyImportMode(btn.getAttribute('data-cb-tab'));
      });
    }
    const cbRefreshBtn = $('codebuddyRefreshBtn');
    if (cbRefreshBtn) cbRefreshBtn.addEventListener('click', () => refreshCodeBuddy(false).then(() => showToast('CodeBuddy 已刷新', 'success')).catch((error) => showToast('刷新失败：' + error.message, 'error')));
    const cbImportBtn = $('cbImportBtn');
    if (cbImportBtn) cbImportBtn.addEventListener('click', () => importCodeBuddyAccounts('single'));
    const cbImportBatchBtn = $('cbImportBatchBtn');
    if (cbImportBatchBtn) cbImportBatchBtn.addEventListener('click', () => importCodeBuddyAccounts('batch'));
    const cbProbeBtn = $('cbProbeBtn');
    if (cbProbeBtn) cbProbeBtn.addEventListener('click', runCodeBuddyProbe);
    const cbAccountRows = $('codebuddyAccountRows');
    if (cbAccountRows) {
      cbAccountRows.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-cb-action]');
        if (!button) return;
        codeBuddyAccountAction(button.getAttribute('data-id'), button.getAttribute('data-cb-action')).catch((error) => {
          showToast('CodeBuddy 操作失败：' + error.message, 'error');
        });
      });
    }

    window.addEventListener('hashchange', () => {
      const hash = (location.hash || '').replace('#', '');
      const view = (hash === 'codebuddy') ? 'codebuddy' : 'cursor';
      if (view !== state.activeView) {
        setActiveView(view, { skipHash: true });
      }
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
