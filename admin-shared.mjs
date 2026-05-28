export function buildAdminSharedStyles() {
  return `
    :root {
      --bg: #F7F6F3;
      --surface: #FFFFFF;
      --surface-alt: #FBFBFA;
      --border: #EAEAEA;
      --border-hover: #D0D0D0;
      --text: #1a1a1a;
      --text-secondary: #787774;
      --text-muted: #a0a0a0;
      --accent: #2563eb;
      --accent-hover: #1d4ed8;
      --success: #16a34a;
      --success-bg: #EDF3EC;
      --success-text: #346538;
      --danger: #dc2626;
      --danger-bg: #FDEBEC;
      --danger-text: #9F2F2D;
      --warn: #d97706;
      --warn-bg: #FBF3DB;
      --warn-text: #956400;
      --info-bg: #E1F3FE;
      --info-text: #1F6C9F;
      --font-ui: "PingFang SC", "Microsoft YaHei UI", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif;
      --font-mono: "SF Mono", "JetBrains Mono", ui-monospace, Consolas, monospace;
      --radius: 8px;
      --radius-lg: 8px;
      --shadow-sm: 0 1px 3px rgba(0,0,0,0.04);
      --shadow-hover: 0 2px 8px rgba(0,0,0,0.06);
      --ease: cubic-bezier(0.16, 1, 0.3, 1);
    }
    *, *::before, *::after { box-sizing: border-box; }
    html { font-size: 14px; }
    html, body {
      margin: 0;
      min-height: 100%;
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-ui);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }
    button, input, textarea, select { font: inherit; }
    button {
      min-height: 36px;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 0.15s var(--ease), border-color 0.15s var(--ease), color 0.15s var(--ease), box-shadow 0.15s var(--ease), transform 0.15s var(--ease);
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
    }
    button:hover:not(:disabled) {
      border-color: var(--border-hover);
      box-shadow: var(--shadow-sm);
    }
    button:active:not(:disabled) { transform: scale(0.97); }
    button:disabled { opacity: 0.45; cursor: not-allowed; }
    button.primary {
      background: var(--text);
      color: #fff;
      border-color: var(--text);
    }
    button.primary:hover:not(:disabled) {
      background: #333;
      border-color: #333;
    }
    button.warn {
      background: var(--warn-bg);
      color: var(--warn-text);
      border-color: var(--warn);
    }
    button.warn:hover:not(:disabled) {
      background: #f5e6b8;
    }
    button.danger {
      background: var(--danger);
      color: #fff;
      border-color: var(--danger);
    }
    button.danger:hover:not(:disabled) {
      background: #b91c1c;
      border-color: #b91c1c;
    }
    button.ghost {
      border-color: var(--border);
      color: var(--text-secondary);
      background: transparent;
    }
    button.ghost:hover:not(:disabled) {
      border-color: var(--border-hover);
      color: var(--text);
      background: var(--surface-alt);
    }
    button.btn-sm { min-height: 30px; padding: 4px 10px; font-size: 12px; }
    button.copy-ok {
      background: var(--success) !important;
      border-color: var(--success) !important;
      color: #fff !important;
    }
    input, textarea, select {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 14px;
      font-family: var(--font-ui);
      background: var(--surface);
      color: var(--text);
      transition: border-color 0.15s, box-shadow 0.15s;
      outline: none;
    }
    input:focus, textarea:focus, select:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(37,99,235,0.1);
    }
    textarea { min-height: 140px; resize: vertical; line-height: 1.55; font-family: var(--font-mono); font-size: 13px; }
    label {
      display: block;
      color: var(--text-secondary);
      font-size: 12px;
      font-weight: 500;
      margin-bottom: 6px;
    }
    .hidden { display: none !important; }
    code {
      font-family: var(--font-mono);
      font-size: 0.92em;
      color: var(--accent);
      background: rgba(37,99,235,0.06);
      padding: 1px 5px;
      border-radius: 3px;
    }

    /* === TOPBAR === */
    .topbar {
      position: sticky;
      top: 0;
      z-index: 100;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .brand-name {
      font-size: 16px;
      font-weight: 600;
      color: var(--text);
    }
    .brand-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text);
    }
    .sub {
      color: var(--text-muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .topbar-actions, .actions, .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }

    /* === VIEW NAV === */
    .view-nav {
      display: flex;
      gap: 2px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 3px;
    }
    .view-tab {
      min-height: 32px;
      padding: 6px 16px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--text-secondary);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 0.15s var(--ease), color 0.15s var(--ease);
      white-space: nowrap;
      box-shadow: none;
    }
    .view-tab:hover:not(.active):not(:disabled) {
      color: var(--text);
      background: rgba(0,0,0,0.03);
      border-color: transparent;
      box-shadow: none;
    }
    .view-tab.active {
      background: var(--surface);
      color: var(--text);
      box-shadow: var(--shadow-sm);
      font-weight: 600;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      padding: 2px 10px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.02em;
    }
    .pill.good { background: var(--success-bg); color: var(--success-text); }
    .pill.bad { background: var(--danger-bg); color: var(--danger-text); }
    .pill.warn { background: var(--warn-bg); color: var(--warn-text); }
    .pill.info { background: var(--info-bg); color: var(--info-text); }
    .pill.muted { background: var(--surface-alt); color: var(--text-muted); border: 1px solid var(--border); }
    .status-indicator {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 10px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 500;
      background: var(--success-bg);
      color: var(--success-text);
    }

    /* === SHELL === */
    .shell {
      position: relative;
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px 20px;
      z-index: 1;
    }

    /* === DASHBOARD HEADER === */
    .dashboard-header {
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
    }
    .dh-title-row {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    .dh-title {
      font-size: 18px;
      font-weight: 700;
      color: var(--text);
    }
    .dh-chips {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text-secondary);
      font-size: 12px;
      white-space: nowrap;
    }
    .chip-key {
      color: var(--text-muted);
      font-size: 11px;
    }
    .chip-val { color: var(--text); font-weight: 600; }
    .chip.good .chip-val { color: var(--success-text); }
    .chip.warn .chip-val { color: var(--warn-text); }
    .chip.bad .chip-val { color: var(--danger-text); }

    /* === METRIC GRID === */
    .metric-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin: 24px 0;
    }
    .metric {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 20px 24px;
      display: flex;
      flex-direction: column;
      transition: box-shadow 0.2s var(--ease), transform 0.2s var(--ease);
    }
    .metric:hover {
      box-shadow: var(--shadow-hover);
      transform: translateY(-1px);
    }
    .metric .label {
      font-size: 12px;
      color: var(--text-secondary);
      margin-bottom: 8px;
      font-weight: 500;
    }
    .metric .value {
      font-size: 32px;
      font-weight: 700;
      color: var(--text);
      font-family: var(--font-mono);
      letter-spacing: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .metric .value.multiline {
      white-space: normal;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      font-size: 14px;
      line-height: 1.4;
      letter-spacing: 0;
    }
    .metric .hint {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 6px;
    }

    /* === PANELS === */
    .content { display: grid; gap: 24px; margin-top: 24px; }
    .panel {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 24px;
    }
    .panel h2 {
      font-size: 16px;
      font-weight: 600;
      color: var(--text);
      margin: 0 0 16px 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .panel h2 .h2-tag {
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 400;
    }
    .ops-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 24px;
    }
    .stack { display: grid; gap: 12px; }
    .split { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }

    /* === TABLE === */
    .table-wrap {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      overflow-x: auto;
    }
    .table { width: 100%; border-collapse: collapse; min-width: 560px; }
    .table th, .table td {
      text-align: left;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }
    .table th {
      background: var(--surface-alt);
      font-size: 12px;
      font-weight: 500;
      color: var(--text-secondary);
      white-space: nowrap;
      position: sticky;
      top: 0;
      z-index: 1;
    }
    .table tr:last-child td { border-bottom: none; }
    .table tbody tr {
      transition: background 0.15s;
    }
    .table tbody tr:hover {
      background: rgba(0,0,0,0.015);
    }
    .table.dense th, .table.dense td { padding: 8px 10px; font-size: 12px; }
    .table.dense .actions-cell { white-space: nowrap; }
    .table.dense .actions-cell button { min-height: 28px; padding: 3px 8px; font-size: 11px; margin: 1px; }
    .table .cell-mono { font-family: var(--font-mono); font-size: 11px; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .table .cell-wrap { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* === BADGES === */
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      border-radius: 9999px;
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 500;
    }
    .badge.good { color: var(--success-text); background: var(--success-bg); }
    .badge.bad { color: var(--danger-text); background: var(--danger-bg); }
    .badge.warn { color: var(--warn-text); background: var(--warn-bg); }

    /* === COPY LINE / MONO BOX === */
    .copyline { display: flex; gap: 8px; align-items: stretch; }
    .copyline input { min-width: 0; }
    .secret-input {
      letter-spacing: 0.16em;
      color: var(--text-secondary);
    }
    .secret-hint {
      margin: 4px 0 12px;
      color: var(--text-muted);
      font-size: 12px;
    }
    .mono-box {
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--surface-alt);
      color: var(--text-secondary);
      padding: 12px 14px;
      white-space: pre-wrap;
      overflow: auto;
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.55;
    }
    .oauth-box {
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--surface-alt);
      padding: 12px 14px;
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-secondary);
      white-space: pre-wrap;
      min-height: 96px;
    }

    /* === ENDPOINTS === */
    .endpoint-list { display: grid; gap: 6px; margin-top: 4px; }
    .endpoint-row {
      display: grid;
      grid-template-columns: 56px minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      padding: 10px 14px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--surface);
      transition: border-color 0.15s, background 0.15s;
    }
    .endpoint-row:hover {
      border-color: var(--border-hover);
      background: var(--surface-alt);
    }
    .endpoint-method {
      font: 600 11px/1 var(--font-mono);
      color: var(--warn-text);
    }
    .endpoint-path {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* === IMPORT TABS === */
    .import-tabs {
      display: flex;
      gap: 0;
      margin-bottom: 18px;
      border-bottom: 1px solid var(--border);
    }
    .import-tabs button {
      border: none;
      border-bottom: 2px solid transparent;
      background: transparent;
      color: var(--text-muted);
      padding: 10px 18px;
      border-radius: 0;
      min-height: 38px;
      font-weight: 500;
      box-shadow: none;
    }
    .import-tabs button:hover:not(.active) {
      color: var(--text);
      background: transparent;
      box-shadow: none;
    }
    .import-tabs button.active {
      color: var(--text);
      border-bottom-color: var(--text);
      background: transparent;
      box-shadow: none;
    }
    .import-pane { display: grid; gap: 12px; }
    .import-hint {
      color: var(--text-muted);
      font-size: 12px;
    }

    /* === FIELD === */
    .field { display: grid; gap: 6px; }
    .field + .field { margin-top: 12px; }

    /* === PROBE RESULT === */
    .probe-result {
      margin-top: 14px;
      position: relative;
      padding: 14px 16px;
      background: var(--surface-alt);
      border: 1px solid var(--border);
      border-radius: 6px;
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.7;
      color: var(--text-secondary);
      overflow: auto;
      transition: border-color 0.2s;
    }
    .probe-result.ok { border-color: var(--success); background: var(--success-bg); }
    .probe-result.fail { border-color: var(--danger); background: var(--danger-bg); }
    .probe-line { white-space: pre-wrap; word-break: break-word; }
    .probe-line strong {
      display: inline-block;
      min-width: 60px;
      color: var(--text);
      font-weight: 600;
      font-size: 11px;
      margin-right: 8px;
    }
    .probe-result.fail .probe-line strong { color: var(--danger-text); }
    .probe-result.ok .probe-line strong { color: var(--success-text); }

    /* === SUBSECTION === */
    .subsection {
      margin-top: 22px;
      padding-top: 18px;
      border-top: 1px dashed var(--border);
    }
    .subsection-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    .subsection-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text);
      letter-spacing: 0.01em;
    }
    .subsection-title .tag {
      color: var(--text-muted);
      font-size: 11px;
      font-weight: 400;
      margin-left: 8px;
      letter-spacing: 0.04em;
    }
    .subsection-note {
      color: var(--text-muted);
      font-size: 12px;
    }
    .codebuddy-summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px 16px;
      padding: 14px 16px;
      background: var(--surface-alt);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      margin-bottom: 16px;
    }
    .codebuddy-summary .kv {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }
    .codebuddy-summary .kv-label {
      color: var(--text-muted);
      font-size: 11px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .codebuddy-summary .kv-value {
      color: var(--text);
      font-size: 13px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .codebuddy-summary .kv-value.mono {
      font-family: var(--font-mono);
      font-size: 12px;
    }

    /* === SECTION HEAD === */
    .section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }
    .section-head h2 { margin: 0; }
    .section-note {
      color: var(--text-muted);
      font-size: 12px;
    }

    /* === EMPTY STATES === */
    .empty-state {
      border: 1px dashed var(--border);
      border-radius: 6px;
      padding: 32px 16px;
      text-align: center;
      color: var(--text-muted);
      font-size: 13px;
    }
    .loading-overlay {
      color: var(--text-muted);
      font-size: 12px;
      padding: 6px 0;
    }

    /* === ADVANCED PANEL === */
    details.advanced-panel {
      margin-top: 24px;
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: var(--surface);
      overflow: hidden;
    }
    details.advanced-panel summary {
      cursor: pointer;
      padding: 16px 24px;
      color: var(--text);
      font-size: 14px;
      font-weight: 600;
      list-style: none;
      user-select: none;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    details.advanced-panel summary::-webkit-details-marker { display: none; }
    details.advanced-panel summary::after {
      content: "+";
      margin-left: auto;
      color: var(--text-muted);
      font-size: 16px;
      font-weight: 400;
    }
    details.advanced-panel[open] summary::after { content: "\\2212"; }
    details.advanced-panel[open] summary { border-bottom: 1px solid var(--border); }
    details.advanced-panel .advanced-body { padding: 18px 24px 22px; }
    details.advanced-panel textarea {
      background: var(--surface-alt);
      font-family: var(--font-mono);
      font-size: 12px;
      min-height: 130px;
    }

    /* === LOGIN === */
    .login-wrap {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 28px;
      background: var(--bg);
    }
    .login {
      position: relative;
      width: 100%;
      max-width: 400px;
      padding: 40px 32px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-sm);
      animation: login-enter 0.5s var(--ease) both;
    }
    .login .brand { margin-bottom: 22px; }
    .login h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 700;
      color: var(--text);
    }
    .login p {
      color: var(--text-secondary);
      margin: 12px 0 22px;
      font-size: 13px;
      line-height: 1.6;
    }
    .login-divider {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 8px 0 18px;
      color: var(--text-muted);
      font-size: 11px;
    }
    .login-divider::before, .login-divider::after {
      content: "";
      flex: 1;
      height: 1px;
      background: var(--border);
    }
    .toast-line, .muted {
      color: var(--text-muted);
      font-size: 12px;
      min-height: 16px;
    }
    .footerline {
      margin-top: 18px;
      color: var(--text-muted);
      font-size: 11px;
      display: flex;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }

    /* === TOAST === */
    .toast-stack {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
    }
    .toast-item {
      pointer-events: auto;
      position: relative;
      min-width: 240px;
      max-width: 360px;
      padding: 12px 16px 12px 18px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: 0 4px 12px rgba(0,0,0,0.08);
      color: var(--text);
      font-size: 13px;
      overflow: hidden;
      animation: toast-in 0.3s var(--ease) both;
    }
    .toast-item::before {
      content: "";
      position: absolute;
      left: 0; top: 0; bottom: 0;
      width: 3px;
      background: var(--accent);
    }
    .toast-item.toast-success::before { background: var(--success); }
    .toast-item.toast-error::before { background: var(--danger); }
    .toast-item.toast-info::before { background: var(--accent); }
    .toast-item.out { animation: toast-out 0.25s var(--ease) forwards; }
    .toast-msg {
      font: 13px/1.5 var(--font-ui);
      color: var(--text);
    }
    .toast-progress {
      position: absolute;
      left: 0; right: 0; bottom: 0;
      height: 2px;
      background: var(--success);
      transform-origin: left;
      animation: toast-progress 2.5s linear forwards;
    }
    .toast-item.toast-error .toast-progress { background: var(--danger); }
    .toast-item.toast-info .toast-progress { background: var(--accent); }

    /* === ANIMATIONS === */
    .css-enter {
      animation: fade-in-up 0.5s var(--ease) both;
      animation-delay: var(--motion-delay, 0ms);
    }
    @keyframes fade-in-up {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes login-enter {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes toast-in {
      from { opacity: 0; transform: translateX(40px); }
      to { opacity: 1; transform: translateX(0); }
    }
    @keyframes toast-out {
      from { opacity: 1; transform: translateX(0); }
      to { opacity: 0; transform: translateX(40px); }
    }
    @keyframes toast-progress {
      from { transform: scaleX(1); }
      to { transform: scaleX(0); }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01s !important;
        transition-duration: 0.01s !important;
      }
    }

    @media (max-width: 1100px) {
      .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .ops-grid, .split { grid-template-columns: 1fr; }
      .content { gap: 20px; }
      details.advanced-panel { margin-top: 20px; }
    }
    @media (max-width: 640px) {
      .topbar { padding: 12px 16px; flex-wrap: wrap; }
      .view-nav { width: 100%; order: 3; }
      .view-tab { flex: 1; text-align: center; padding: 6px 8px; font-size: 12px; }
      .shell { padding: 16px 12px; }
      .metric-grid { grid-template-columns: 1fr; gap: 12px; }
      .metric { padding: 16px 18px; }
      .metric .value { font-size: 24px; }
      .copyline { display: grid; }
      .endpoint-row { grid-template-columns: auto 1fr; gap: 8px; }
      .endpoint-row > button { grid-column: 1 / -1; }
      .panel { padding: 18px; }
      .login { padding: 28px 22px; }
      .toast-stack { top: 12px; right: 12px; left: 12px; }
      .toast-item { max-width: none; }
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
      return text.slice(0, max - 1) + '\\u2026';
    }
    function prefersReducedMotion() {
      return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    function showToast(message, type) {
      const variant = (type === 'success' || type === 'error' || type === 'info') ? type : 'info';
      let stack = document.getElementById('toastStack');
      if (!stack) {
        stack = document.createElement('div');
        stack.id = 'toastStack';
        stack.className = 'toast-stack';
        document.body.appendChild(stack);
      }
      const node = document.createElement('div');
      node.className = 'toast-item toast-' + variant;
      const msg = document.createElement('div');
      msg.className = 'toast-msg';
      msg.textContent = String(message == null ? '' : message);
      const bar = document.createElement('div');
      bar.className = 'toast-progress';
      node.appendChild(msg);
      node.appendChild(bar);
      stack.appendChild(node);
      const ttl = prefersReducedMotion() ? 1800 : 2500;
      const remove = () => {
        if (!node.parentNode) return;
        node.classList.add('out');
        setTimeout(() => { if (node.parentNode) node.remove(); }, 240);
      };
      setTimeout(remove, ttl);
      node.addEventListener('click', remove);
    }
    async function copyText(text, label, button) {
      if (!text) return false;
      let ok = false;
      try {
        if (!navigator.clipboard || !window.isSecureContext) throw new Error('clipboard_unavailable');
        await navigator.clipboard.writeText(text);
        ok = true;
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
        ok = document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      if (ok && button instanceof HTMLElement) {
        const original = button.textContent;
        button.classList.add('copy-ok');
        button.textContent = '\\u2713 \\u5df2\\u590d\\u5236';
        setTimeout(() => {
          button.classList.remove('copy-ok');
          button.textContent = original;
        }, 1500);
      }
      showToast(ok ? ((label || '\\u5185\\u5bb9') + ' \\u5df2\\u590d\\u5236') : '\\u590d\\u5236\\u5931\\u8d25\\uff0c\\u8bf7\\u624b\\u52a8\\u590d\\u5236', ok ? 'success' : 'error');
      return ok;
    }
    function animateValue(el, from, to, duration) {
      if (!el) return;
      const target = Number(to) || 0;
      if (prefersReducedMotion()) { el.textContent = String(target); return; }
      const start = performance.now();
      const f = Number(from) || 0;
      const dur = Math.max(120, Number(duration) || 600);
      function step(now) {
        const p = Math.min(1, (now - start) / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        const v = Math.round(f + (target - f) * eased);
        el.textContent = String(v);
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }
    function bindCopyButtons(root) {
      (root || document).querySelectorAll('[data-copy]').forEach((button) => {
        if (button.dataset.bound === '1') return;
        button.dataset.bound = '1';
        button.addEventListener('click', () => copyText(button.getAttribute('data-copy'), button.textContent.trim(), button));
      });
    }
    function renderEndpoint(method, path) {
      return '<div class="endpoint-row">' +
        '<div class="endpoint-method">' + escapeHtml(method) + '</div>' +
        '<div class="endpoint-path" title="' + escapeHtml(path) + '">' + escapeHtml(path) + '</div>' +
        '<button type="button" class="btn-sm" data-copy="' + escapeHtml(path) + '">\\u590d\\u5236</button>' +
      '</div>';
    }
    function renderChip(key, value, variant) {
      const cls = 'chip' + (variant ? ' ' + variant : '');
      return '<span class="' + cls + '"><span class="chip-key">' + escapeHtml(key) + '</span><span class="chip-val">' + escapeHtml(value) + '</span></span>';
    }
  `;
}
