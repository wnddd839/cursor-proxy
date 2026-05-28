export function buildAdminSharedStyles() {
  return `
    :root {
      --bg: #080b10;
      --panel: rgba(16, 22, 31, 0.88);
      --panel-2: #121a25;
      --panel-3: #0e141d;
      --line: rgba(139, 154, 177, 0.2);
      --line-strong: rgba(177, 190, 211, 0.34);
      --text: #eef4fb;
      --muted: #a8b4c7;
      --faint: #718097;
      --accent: #49e6ae;
      --accent-hover: #86f5c9;
      --accent-2: #7dd3fc;
      --accent-dim: rgba(73, 230, 174, 0.12);
      --accent-line: rgba(73, 230, 174, 0.42);
      --warn: #f8c96a;
      --warn-dim: rgba(248, 201, 106, 0.13);
      --bad: #ff7f8c;
      --bad-dim: rgba(255, 127, 140, 0.13);
      --ink: #06110d;
      --shadow: 0 20px 54px rgba(0, 0, 0, 0.34);
      --radius: 8px;
      --font-ui: "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI Variable", "Segoe UI", sans-serif;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      min-height: 100%;
      background:
        linear-gradient(135deg, rgba(73, 230, 174, 0.12) 0%, rgba(73, 230, 174, 0) 38%),
        linear-gradient(225deg, rgba(125, 211, 252, 0.1) 0%, rgba(125, 211, 252, 0) 34%),
        linear-gradient(180deg, #070a0f 0%, #0a0f16 46%, #070a0f 100%);
      background-attachment: fixed;
      color: var(--text);
      font: 14px/1.55 var(--font-ui);
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      opacity: 0.09;
      background-image:
        linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255, 255, 255, 0.04) 1px, transparent 1px);
      background-size: 28px 28px;
      mask-image: linear-gradient(180deg, black, transparent 72%);
    }
    button, input, textarea, select { font: inherit; }
    button {
      min-height: 38px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 9px 14px;
      background: linear-gradient(180deg, rgba(31, 42, 57, 0.96), rgba(21, 29, 41, 0.96));
      color: var(--text);
      cursor: pointer;
      transition: border-color 0.18s, background 0.18s, transform 0.18s, box-shadow 0.18s;
    }
    button:hover:not(:disabled) {
      border-color: var(--line-strong);
      background: linear-gradient(180deg, rgba(39, 52, 70, 0.98), rgba(25, 35, 49, 0.98));
      transform: translateY(-1px);
      box-shadow: 0 10px 22px rgba(0, 0, 0, 0.22);
    }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    button.primary {
      background: linear-gradient(180deg, #3ee0a5, #22c58b);
      border-color: #6ee7b7;
      color: var(--ink);
      font-weight: 700;
      box-shadow: 0 10px 28px rgba(52, 211, 153, 0.18);
    }
    button.primary:hover:not(:disabled) {
      background: linear-gradient(180deg, #6ee7b7, #34d399);
      border-color: #a7f3d0;
    }
    button.ghost { background: rgba(255, 255, 255, 0.02); }
    button.warn {
      background: var(--warn-dim);
      border-color: rgba(251, 191, 36, 0.4);
      color: #fde68a;
    }
    button.danger {
      background: var(--bad-dim);
      border-color: rgba(248, 113, 113, 0.4);
      color: #fecaca;
    }
    button.btn-sm {
      min-height: 30px;
      padding: 4px 10px;
      font-size: 12px;
    }
    input, textarea, select {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 8px;
      color: var(--text);
      background: rgba(8, 12, 18, 0.86);
      padding: 10px 12px;
      outline: none;
      transition: border-color 0.18s, box-shadow 0.18s, background 0.18s;
    }
    input:focus, textarea:focus, select:focus {
      border-color: var(--accent-line);
      box-shadow: 0 0 0 3px var(--accent-dim);
    }
    textarea { min-height: 150px; resize: vertical; font-family: var(--font-mono); font-size: 13px; }
    label {
      display: block;
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    .hidden { display: none !important; }
    .shell {
      position: relative;
      max-width: 1480px;
      margin: 0 auto;
      padding: 18px 22px 36px;
    }
    .topbar, .panel, .login, .metric {
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      backdrop-filter: blur(14px);
    }
    .topbar {
      position: sticky;
      top: 12px;
      z-index: 20;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 16px;
      overflow: hidden;
    }
    .topbar::after {
      content: "";
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 1px;
      background: linear-gradient(90deg, transparent, var(--accent-line), transparent);
    }
    .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .mark {
      width: 42px;
      height: 42px;
      border-radius: 8px;
      background:
        linear-gradient(145deg, rgba(73, 230, 174, 0.95), rgba(125, 211, 252, 0.86)),
        #34d399;
      color: var(--ink);
      display: grid;
      place-items: center;
      font: 800 14px/1 var(--font-mono);
      flex-shrink: 0;
      box-shadow: 0 12px 26px rgba(73, 230, 174, 0.16);
    }
    .title { font-size: 18px; font-weight: 750; line-height: 1.2; letter-spacing: -0.01em; }
    .sub { color: var(--muted); font-size: 12px; margin-top: 4px; overflow-wrap: anywhere; }
    .actions, .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .hero-panel {
      margin-top: 22px;
      padding: 8px 2px 0;
      display: grid;
      gap: 18px;
    }
    .hero-head {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      align-items: flex-start;
      flex-wrap: wrap;
    }
    .hero-kicker {
      color: var(--accent);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }
    .hero-title {
      margin-top: 7px;
      max-width: 980px;
      font-size: clamp(24px, 3vw, 38px);
      font-weight: 780;
      line-height: 1.08;
      letter-spacing: 0;
    }
    .hero-copy { margin-top: 10px; max-width: 820px; color: var(--muted); font-size: 14px; }
    .hero-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .status-pills { display: flex; gap: 8px; flex-wrap: wrap; }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 6px 10px;
      color: var(--muted);
      background: rgba(10, 15, 22, 0.72);
      font-size: 12px;
      white-space: nowrap;
    }
    .pill.good { color: var(--accent); border-color: var(--accent-line); background: var(--accent-dim); }
    .pill.warn { color: var(--warn); border-color: rgba(251, 191, 36, 0.35); background: var(--warn-dim); }
    .pill.bad { color: var(--bad); border-color: rgba(248, 113, 113, 0.35); background: var(--bad-dim); }
    .pill strong { color: var(--text); font-weight: 650; }
    .metric-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }
    .metric {
      position: relative;
      padding: 15px 16px;
      min-height: 100px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transition: border-color 0.18s, transform 0.18s, background 0.18s;
      will-change: transform;
    }
    .metric::before {
      content: "";
      position: absolute;
      inset: 0 0 auto;
      height: 2px;
      background: linear-gradient(90deg, var(--accent), var(--accent-2));
      opacity: 0.55;
    }
    .metric:hover {
      border-color: var(--line-strong);
      transform: translateY(-2px);
      background: rgba(18, 27, 39, 0.92);
    }
    .metric .label {
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin: 0;
    }
    .metric .value {
      margin-top: 9px;
      font: 760 22px/1.15 var(--font-mono);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .metric .value.multiline {
      white-space: normal;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      font-size: 15px;
      line-height: 1.35;
    }
    .metric .hint { margin-top: auto; padding-top: 8px; color: var(--faint); font-size: 12px; }
    .content { display: grid; gap: 16px; margin-top: 18px; }
    .panel {
      padding: 18px 20px;
      transition: border-color 0.18s, background 0.18s, transform 0.18s;
      will-change: transform;
    }
    .panel:hover {
      border-color: rgba(177, 190, 211, 0.28);
      background: rgba(17, 24, 35, 0.92);
    }
    .panel h2 {
      margin: 0 0 14px;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: -0.01em;
    }
    .ops-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }
    .stack { display: grid; gap: 12px; }
    .split { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .table-wrap {
      overflow-x: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(7, 11, 16, 0.5);
    }
    .table { width: 100%; border-collapse: collapse; min-width: 520px; }
    .table th, .table td {
      text-align: left;
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
    }
    .table th {
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      background: rgba(11, 16, 23, 0.92);
      position: sticky;
      top: 0;
      z-index: 1;
    }
    .table tr:last-child td { border-bottom: none; }
    .table tbody tr:hover td { background: rgba(125, 211, 252, 0.035); }
    .mono, .mono-box {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(8, 12, 18, 0.86);
      color: var(--muted);
      padding: 12px 14px;
      white-space: pre-wrap;
      overflow: auto;
      font-family: var(--font-mono);
      font-size: 13px;
      line-height: 1.5;
    }
    .copyline { display: flex; gap: 8px; align-items: stretch; }
    .copyline input { min-width: 0; font-family: var(--font-mono); font-size: 13px; }
    .secret-input {
      letter-spacing: 0.08em;
      color: var(--accent-2);
    }
    .secret-hint {
      margin: -4px 0 12px;
      color: var(--faint);
      font-size: 12px;
    }
    .account-card {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(8, 12, 18, 0.86);
      padding: 14px 16px;
      display: grid;
      gap: 12px;
    }
    .account-card.empty { color: var(--muted); text-align: center; padding: 28px; }
    .kv-row {
      display: grid;
      grid-template-columns: 88px minmax(0, 1fr) auto;
      gap: 10px;
      align-items: start;
    }
    .kv-row .kv-key {
      color: var(--faint);
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      padding-top: 2px;
    }
    .kv-row .kv-val {
      font-family: var(--font-mono);
      font-size: 13px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--text);
    }
    .kv-row .kv-val.wrap { white-space: normal; word-break: break-all; }
    .endpoint-list { display: grid; gap: 8px; }
    .endpoint-row {
      display: grid;
      grid-template-columns: 56px minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(8, 12, 18, 0.86);
      transition: border-color 0.18s, transform 0.18s, background 0.18s;
    }
    .endpoint-row:hover {
      border-color: var(--line-strong);
      transform: translateY(-1px);
      background: rgba(12, 19, 28, 0.92);
    }
    .endpoint-method {
      font: 700 11px/1 var(--font-mono);
      color: var(--accent);
      letter-spacing: 0.06em;
    }
    .endpoint-path {
      font-family: var(--font-mono);
      font-size: 13px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .latency-steps {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }
    .step {
      border: 1px dashed rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      padding: 12px;
      color: var(--muted);
      font-size: 13px;
      min-height: 78px;
    }
    .step strong { display: block; color: var(--text); margin-bottom: 4px; font-size: 13px; }
    .login-wrap { min-height: 100vh; display: grid; place-items: center; padding: 22px; }
    .login { width: min(520px, 100%); padding: 24px; }
    .login h1 { margin: 0; font-size: 26px; font-weight: 750; letter-spacing: -0.02em; }
    .login p { color: var(--muted); margin: 12px 0 20px; }
    .field { display: grid; gap: 8px; }
    .toast, .muted { color: var(--muted); font-size: 12px; min-height: 18px; }
    .footerline {
      margin-top: 14px;
      color: var(--faint);
      font-size: 12px;
      display: flex;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }
    details.advanced-panel {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--panel);
      overflow: hidden;
    }
    details.advanced-panel summary {
      cursor: pointer;
      padding: 14px 20px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 600;
      list-style: none;
      user-select: none;
    }
    details.advanced-panel summary::-webkit-details-marker { display: none; }
    details.advanced-panel summary::after {
      content: "展开";
      float: right;
      color: var(--faint);
      font-size: 12px;
    }
    details.advanced-panel[open] summary::after { content: "收起"; }
    details.advanced-panel .advanced-body { padding: 0 20px 18px; }
    .global-toast {
      position: fixed;
      bottom: 22px;
      left: 50%;
      transform: translateX(-50%) translateY(12px);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s, transform 0.2s;
      background: rgba(16, 22, 31, 0.96);
      border: 1px solid var(--accent-line);
      color: var(--text);
      padding: 10px 16px;
      border-radius: 999px;
      font-size: 13px;
      z-index: 100;
      box-shadow: var(--shadow);
    }
    .global-toast.show {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    .probe-result {
      display: grid;
      gap: 6px;
      margin-top: 12px;
    }
    .probe-line { font-family: var(--font-mono); font-size: 13px; color: var(--muted); }
    .probe-line strong { color: var(--text); font-weight: 600; }
    .section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }
    .section-head h2 { margin: 0; }
    .section-note { color: var(--faint); font-size: 12px; }
    .metric-grid.six {
      grid-template-columns: repeat(6, minmax(0, 1fr));
    }
    .metric-grid.six .metric { min-height: 88px; }
    .metric-grid.six .metric .value { font-size: 20px; }
    .badge {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 3px 8px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
    }
    .badge.good { color: var(--accent); background: var(--accent-dim); border: 1px solid var(--accent-line); }
    .badge.bad { color: var(--bad); background: var(--bad-dim); border: 1px solid rgba(248, 113, 113, 0.35); }
    .badge.warn { color: var(--warn); background: var(--warn-dim); border: 1px solid rgba(251, 191, 36, 0.35); }
    .table.dense th, .table.dense td { padding: 8px 10px; font-size: 12px; }
    .table.dense .actions-cell { white-space: nowrap; }
    .table.dense .actions-cell button { min-height: 28px; padding: 4px 8px; font-size: 11px; margin: 1px; }
    .table .cell-mono { font-family: var(--font-mono); font-size: 11px; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .table .cell-wrap { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .empty-state {
      border: 1px dashed var(--line);
      border-radius: 8px;
      padding: 28px 16px;
      text-align: center;
      color: var(--muted);
      background: rgba(13, 18, 25, 0.5);
    }
    .import-tabs { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
    .import-tabs button.active {
      border-color: var(--accent-line);
      background: var(--accent-dim);
      color: var(--accent);
    }
    .oauth-box {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(8, 12, 18, 0.86);
      padding: 12px 14px;
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--muted);
      white-space: pre-wrap;
      min-height: 96px;
    }
    .loading-overlay {
      color: var(--muted);
      font-size: 13px;
      padding: 8px 0;
    }
    [data-motion] { will-change: transform, opacity; }
    .css-enter {
      animation: admin-enter 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both;
      animation-delay: var(--motion-delay, 0ms);
    }
    @keyframes admin-enter {
      from { opacity: 0; transform: translateY(14px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.001ms !important;
        animation-iteration-count: 1 !important;
        scroll-behavior: auto !important;
        transition-duration: 0.001ms !important;
      }
    }
    @media (max-width: 1100px) {
      .metric-grid.six { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .ops-grid, .split, .latency-steps { grid-template-columns: 1fr; }
    }
    @media (max-width: 640px) {
      .shell { padding: 12px 14px 24px; }
      .topbar { flex-direction: column; align-items: flex-start; }
      .metric-grid { grid-template-columns: 1fr; }
      .metric-grid.six { grid-template-columns: 1fr; }
      .metric .value { font-size: 20px; }
      .copyline { display: grid; }
      .kv-row { grid-template-columns: 1fr; gap: 4px; }
      .endpoint-row { grid-template-columns: 1fr; gap: 6px; }
      .hero-title { font-size: 19px; }
    }
  `;
}

export function buildAdminClientUtils() {
  return `
    function escapeHtml(value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[char]);
    }
    function fmtMs(value) {
      const n = Math.max(0, Math.round(Number(value) || 0));
      if (!n) return '-';
      return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 1 : 2) + 's' : n + 'ms';
    }
    function fmtBytes(bytes) {
      const units = ['B', 'KB', 'MB', 'GB'];
      let n = Number(bytes) || 0;
      let i = 0;
      while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
      return n.toFixed(n >= 10 || i === 0 ? 0 : 1) + ' ' + units[i];
    }
    function fmtTime(ms) {
      if (!ms) return '-';
      return new Date(ms).toLocaleString();
    }
    function truncateText(value, max) {
      const text = String(value == null ? '' : value);
      if (text.length <= max) return text;
      return text.slice(0, max - 1) + '…';
    }
    let toastTimer = null;
    function showToast(message) {
      let node = document.getElementById('globalToast');
      if (!node) {
        node = document.createElement('div');
        node.id = 'globalToast';
        node.className = 'global-toast';
        document.body.appendChild(node);
      }
      node.textContent = message;
      node.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => node.classList.remove('show'), 2200);
    }
    async function copyText(text, label) {
      if (!text) return;
      try {
        if (!navigator.clipboard || !window.isSecureContext) throw new Error('clipboard_unavailable');
        await navigator.clipboard.writeText(text);
        showToast((label || '内容') + ' 已复制');
      } catch {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '0';
        document.body.appendChild(textarea);
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
        const copied = document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast(copied ? ((label || '内容') + ' 已复制') : '复制失败，请手动复制');
      }
    }
    function renderKvRow(key, value, copyValue) {
      const safe = escapeHtml(value || '-');
      const copy = copyValue ? '<button type="button" class="btn-sm" data-copy="' + escapeHtml(copyValue) + '">复制</button>' : '';
      return '<div class="kv-row"><div class="kv-key">' + escapeHtml(key) + '</div><div class="kv-val" title="' + safe + '">' + safe + '</div>' + copy + '</div>';
    }
    function bindCopyButtons(root) {
      (root || document).querySelectorAll('[data-copy]').forEach((button) => {
        if (button.dataset.bound === '1') return;
        button.dataset.bound = '1';
        button.addEventListener('click', () => copyText(button.getAttribute('data-copy'), button.textContent.trim()));
      });
    }
    function renderEndpoint(method, path) {
      return '<div class="endpoint-row">' +
        '<div class="endpoint-method">' + escapeHtml(method) + '</div>' +
        '<div class="endpoint-path" title="' + escapeHtml(path) + '">' + escapeHtml(path) + '</div>' +
        '<button type="button" class="btn-sm" data-copy="' + escapeHtml(path) + '">复制</button>' +
      '</div>';
    }
  `;
}
