import { tableSortScript } from "./ui/table-sort.js";
import { waitModalScript } from "./ui/wait-modal.js";

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function layout(
  title: string,
  body: string,
  opts?: {
    flash?: string;
    error?: string;
    wrapClass?: string;
    extraHead?: string;
    waitJob?: { id: string; kind: string; title: string };
  }
): string {
  return `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)} · BWB Comms</title>
  ${opts?.extraHead ?? ""}
  <style>
    :root {
      --bg: #f5f5f7; --surface: #fff; --text: #1d1d1f; --muted: #86868b;
      --accent: #1d1d1f; --accent-soft: #424245; --border: #d2d2d7;
      --border-soft: #e8e8ed; --fill: #fbfbfd; --fill-hover: #f0f0f2;
      --shadow: 0 2px 16px rgba(0,0,0,.06); --radius: 12px;
      --font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
      --mono: "SF Mono", ui-monospace, Menlo, Monaco, Consolas, monospace;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; font-family: var(--font); background: var(--bg); color: var(--text); line-height: 1.47; }
    a { color: var(--accent-soft); text-decoration: none; }
    a:hover { text-decoration: underline; text-underline-offset: 3px; color: var(--text); }
    .wrap { max-width: 1100px; margin: 0 auto; padding: 2rem 1.25rem 5rem; }
    .wrap.wide { max-width: none; padding: 1.25rem 1rem 4rem; }
    header.app { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border-soft); flex-wrap: wrap; }
    header.app h1 { font-size: 1.25rem; font-weight: 600; margin: 0; letter-spacing: -.03em; }
    header.app nav { display: flex; gap: 1rem; font-size: .9rem; color: var(--muted); flex-wrap: wrap; }
    header.app nav a.active { color: var(--text); font-weight: 500; }
    h2 { font-size: 1.05rem; font-weight: 600; margin: 1.25rem 0 .75rem; }
    .flash, .error { background: var(--surface); border: 1px solid var(--border-soft); border-radius: var(--radius); padding: .85rem 1rem; margin-bottom: 1rem; box-shadow: var(--shadow); }
    .panel { background: var(--surface); border: 1px solid var(--border-soft); border-radius: var(--radius); padding: 1.15rem 1.25rem; box-shadow: var(--shadow); margin-bottom: 1rem; }
    .narrow { max-width: 420px; margin: 0 auto; }
    .stack { display: flex; flex-direction: column; gap: .85rem; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: .85rem; }
    @media (max-width: 640px) { .row { grid-template-columns: 1fr; } }
    label { display: flex; flex-direction: column; gap: .35rem; font-size: .8125rem; font-weight: 500; color: var(--muted); }
    input, select, textarea { font: inherit; font-size: 1rem; color: var(--text); background: var(--fill); border: 1px solid var(--border); border-radius: 10px; padding: .65rem .75rem; }
    textarea { min-height: 6rem; }
    .actions { display: flex; flex-wrap: wrap; gap: .65rem; align-items: center; margin-top: .5rem; }
    button, .btn { appearance: none; font: inherit; font-size: .9375rem; font-weight: 500; border-radius: 980px; padding: .55rem 1.15rem; border: none; cursor: pointer; background: var(--accent); color: #fff; text-decoration: none; display: inline-block; text-align: center; }
    button.secondary, .btn.secondary { background: var(--fill-hover); color: var(--text); }
    button.secondary:hover, .btn.secondary:hover { text-decoration: none; background: var(--border-soft); }
    table { width: 100%; border-collapse: collapse; font-size: .875rem; }
    th, td { text-align: left; padding: .65rem .4rem; border-bottom: 1px solid var(--border-soft); vertical-align: top; }
    th { color: var(--muted); font-weight: 500; font-size: .75rem; }
    th.sortable { cursor: pointer; user-select: none; }
    th.sortable:hover { color: var(--text); }
    th.sortable[aria-sort="ascending"], th.sortable[aria-sort="descending"] { color: var(--text); }
    .sort-mark { font-family: var(--mono); font-size: .65rem; color: var(--accent-soft); margin-left: .15rem; letter-spacing: .02em; }
    .table-scroll { overflow-x: auto; }
    table.one-line th, table.one-line td { white-space: nowrap; vertical-align: middle; padding: .45rem .4rem; font-size: .75rem; }
    table.one-line th { font-size: .6875rem; }
    table.one-line form { margin: 0; display: block; }
    table.one-line .btn, table.one-line button {
      width: 5.6rem; box-sizing: border-box; font-size: .75rem; font-weight: 500;
      padding: .4rem .45rem; border-radius: 8px;
    }
    .mono { font-family: var(--mono); font-size: .8rem; }
    .muted { color: var(--muted); }
    .check-list { max-height: 22rem; overflow: auto; border: 1px solid var(--border); border-radius: 10px; padding: .35rem .75rem .6rem; background: var(--fill); }
    .check-list fieldset { border: 0; margin: .65rem 0 0; padding: 0; }
    .check-list legend { font-size: .75rem; font-weight: 600; color: var(--muted); padding: 0; }
    .check-list .chk { flex-direction: row; align-items: center; gap: .5rem; font-size: .875rem; font-weight: 400; color: var(--text); margin: .2rem 0; }
    .check-list .mini { margin: .25rem 0 .4rem; font-size: .75rem; padding: .3rem .7rem; }
    .badge { display: inline-block; font-size: .6875rem; padding: .15rem .5rem; border-radius: 980px; background: var(--fill-hover); }
    .badge.ok { background: #e8f5e9; color: #1e4620; }
    .badge.err { background: #fce8e6; color: #8c1d18; }
    .job-step { margin: 1rem 0 1.25rem; }
    .job-step h3 { margin: 0 0 .4rem; font-size: .95rem; }
    .job-lines { margin: .5rem 0 0; padding-left: 1.15rem; }
    .job-lines li { margin: .3rem 0; }
    .job-split { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-top: 1.25rem; padding-top: 1.15rem; border-top: 1px solid var(--border-soft); align-items: start; }
    @media (max-width: 720px) { .job-split { grid-template-columns: 1fr; } }
    .job-col { display: flex; flex-direction: column; gap: .75rem; }
    .job-col h2 { margin: 0 0 .15rem; }
    .job-col form { margin: 0; }
    .job-col button { width: 100%; }
    .has-tip { position: relative; }
    .has-tip[data-help]::after {
      content: attr(data-help);
      position: absolute; left: 0; right: auto; top: calc(100% + .45rem);
      z-index: 8; width: max(100%, 16rem); max-width: 22rem;
      background: #1d1d1f; color: #fff; font-size: .75rem; font-weight: 400;
      line-height: 1.4; padding: .6rem .75rem; border-radius: 8px;
      text-align: left; white-space: normal;
      opacity: 0; visibility: hidden; pointer-events: none;
      box-shadow: var(--shadow);
    }
    .has-tip[data-help]:hover::after, .has-tip[data-help]:focus::after {
      opacity: 1; visibility: visible;
    }
    .bwb-wait-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,.28); z-index: 200;
      display: none; align-items: center; justify-content: center; padding: 1rem;
    }
    .bwb-wait-backdrop.open { display: flex; }
    .bwb-wait-dialog {
      max-width: 26rem; width: 100%; text-align: center;
      background: var(--surface); border: 1px solid var(--border-soft);
      border-radius: 16px; padding: 1.5rem 1.35rem 1.25rem; box-shadow: 0 20px 50px rgba(0,0,0,.14);
    }
    .bwb-wait-title { margin: 0 0 .4rem; font-size: 1.1rem; font-weight: 650; }
    .bwb-wait-lead { margin: 0 0 1.1rem; font-size: .875rem; color: var(--muted); line-height: 1.45; }
    .bwb-wait-progress-track { height: 10px; border-radius: 999px; background: var(--fill-hover); overflow: hidden; }
    .bwb-wait-progress-bar { height: 100%; width: 0; border-radius: 999px; background: var(--accent); transition: width .35s ease; }
    .bwb-wait-progress-meta { display: flex; justify-content: space-between; align-items: center; margin-top: .65rem; font-size: .8125rem; }
    .bwb-wait-progress-pct { font-weight: 650; }
    .bwb-wait-progress-label { color: var(--muted); font-weight: 500; }
    .bwb-wait-steps { list-style: none; margin: 1rem 0 0; padding: 0; text-align: left; font-size: .8125rem; }
    .bwb-wait-steps--hidden { display: none; }
    .bwb-wait-steps li { position: relative; padding: .5rem 0 .5rem 1.7rem; color: var(--muted); border-bottom: 1px solid var(--border-soft); }
    .bwb-wait-steps li:last-child { border-bottom: none; }
    .bwb-wait-steps li::before {
      content: ""; position: absolute; left: 0; top: 50%; transform: translateY(-50%);
      width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--border); background: var(--surface);
    }
    .bwb-wait-steps li.active { color: var(--text); font-weight: 650; }
    .bwb-wait-steps li.active::before { border-color: var(--accent); background: var(--accent); box-shadow: 0 0 0 3px var(--fill-hover); }
    .bwb-wait-steps li.done { color: var(--muted); }
    .bwb-wait-steps li.done::before { border-color: #16a34a; background: #16a34a; }
  </style>
</head>
<body${opts?.waitJob ? ` data-wait-id="${esc(opts.waitJob.id)}" data-wait-kind="${esc(opts.waitJob.kind)}" data-wait-title="${esc(opts.waitJob.title)}"` : ""}>
  <div class="wrap${opts?.wrapClass ? ` ${esc(opts.wrapClass)}` : ""}">
    ${opts?.flash ? `<div class="flash">${esc(opts.flash)}</div>` : ""}
    ${opts?.error ? `<div class="error">${esc(opts.error)}</div>` : ""}
    ${body}
  </div>
  <div id="bwb-wait-modal" class="bwb-wait-backdrop" aria-hidden="true" role="dialog" aria-labelledby="bwb-wait-modal-title" aria-modal="true">
    <div class="bwb-wait-dialog">
      <h3 id="bwb-wait-modal-title" class="bwb-wait-title">A processar</h3>
      <p id="bwb-wait-modal-lead" class="bwb-wait-lead">Aguarde enquanto a operação decorre.</p>
      <div class="bwb-wait-progress-wrap" aria-live="polite">
        <div class="bwb-wait-progress-track">
          <div id="bwb-wait-progress-bar" class="bwb-wait-progress-bar" style="width: 0%"></div>
        </div>
        <div class="bwb-wait-progress-meta">
          <span id="bwb-wait-progress-pct" class="bwb-wait-progress-pct">0%</span>
          <span id="bwb-wait-progress-label" class="bwb-wait-progress-label">A iniciar…</span>
        </div>
      </div>
      <ul class="bwb-wait-steps bwb-wait-steps--hidden" id="bwb-wait-steps" hidden></ul>
    </div>
  </div>
  <script>${tableSortScript}</script>
  <script>${waitModalScript}</script>
</body>
</html>`;
}

export type Nav =
  | "unanswered"
  | "invoices"
  | "whatsapp"
  | "kb"
  | "rules"
  | "jobs";

export function header(active: Nav): string {
  const item = (href: string, id: Nav, label: string) =>
    `<a href="${href}" class="${active === id ? "active" : ""}">${label}</a>`;
  return `<header class="app">
    <h1>BWB Comms</h1>
    <nav>
      ${item("/admin", "unanswered", "Não respondidos")}
      ${item("/admin/invoices", "invoices", "Facturas")}
      ${item("/admin/whatsapp", "whatsapp", "WhatsApp")}
      ${item("/admin/kb", "kb", "KB")}
      ${item("/admin/rules", "rules", "Regras")}
      ${item("/admin/jobs", "jobs", "Jobs")}
      <a href="/admin/pack.md">Pack ChatGPT</a>
      <a href="/admin/logout">Sair</a>
    </nav>
  </header>`;
}

export { esc };
