import type { Claim } from "./db.js";
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export const money = (n: number, cur = "INR") => new Intl.NumberFormat("en-IN", { style: "currency", currency: cur }).format(n);
export const CATEGORIES = ["Meals", "Travel", "Accommodation", "Software", "Office Supplies", "Client Entertainment", "Fuel", "Other"];

const css = `
:root{--bg:#f6f7fb;--card:#fff;--ink:#14161f;--mut:#6b7185;--line:#e4e7ef;--acc:#4f46e5;--ok:#0f9d58;--bad:#d93025;--warn:#b7791f}
@media(prefers-color-scheme:dark){:root{--bg:#0f1117;--card:#181b25;--ink:#eceef6;--mut:#99a0b5;--line:#2a2f3f;--acc:#8b85ff}}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--ink)}
header{display:flex;justify-content:space-between;align-items:center;padding:14px 24px;border-bottom:1px solid var(--line);background:var(--card)}
header b{font-size:17px}header a{color:var(--mut);margin-left:16px;text-decoration:none}
main{max-width:980px;margin:24px auto;padding:0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin-bottom:16px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line)}th{color:var(--mut);font-weight:500;font-size:13px}
.wrap{overflow-x:auto}
a{color:var(--acc)}
.pill{padding:2px 10px;border-radius:99px;font-size:12px;font-weight:600;background:var(--line)}
.pill.approved{background:#0f9d5822;color:var(--ok)}.pill.rejected{background:#d9302522;color:var(--bad)}.pill.submitted{background:#b7791f22;color:var(--warn)}
label{display:block;font-size:13px;color:var(--mut);margin:12px 0 4px}
input,select,textarea{width:100%;padding:9px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit}
button,.btn{background:var(--acc);color:#fff;border:0;padding:9px 16px;border-radius:8px;font:inherit;cursor:pointer;text-decoration:none;display:inline-block}
button.ok{background:var(--ok)}button.bad{background:var(--bad)}button.ghost,.btn.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}@media(max-width:640px){.grid{grid-template-columns:1fr}}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:end}.row>*{flex:1;min-width:120px}
.stats{display:flex;gap:16px;flex-wrap:wrap}.stats div{flex:1;min-width:140px}.stats b{font-size:22px;display:block}
.tl{list-style:none;padding:0;margin:0}.tl li{padding:6px 0;border-bottom:1px dashed var(--line);font-size:14px}.tl small{color:var(--mut)}
img.rcpt{max-width:100%;border-radius:8px;border:1px solid var(--line)}
.copy{font-family:monospace;font-size:13px;word-break:break-all;background:var(--bg);padding:8px;border-radius:8px}
`;
export const page = (title: string, body: string, nav = true) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${css}</style></head><body>
<header><b>🧾 ClaimDesk</b>${nav ? `<nav><a href="/">Claims</a><a href="/connect">Connect Claude</a><a href="/export.csv">Export CSV</a><a href="/logout">Log out</a></nav>` : ""}</header>
<main>${body}</main></body></html>`;
export const pill = (s: string) => `<span class="pill ${esc(s)}">${esc(s)}</span>`;
export const claimRow = (c: Claim, cur: string) =>
  `<tr><td><a href="/claims/${c.id}">#${c.id}</a></td><td>${esc(c.merchant)}</td><td>${esc(c.claimant_name)}</td><td>${esc(c.date)}</td><td>${esc(c.category)}</td><td>${money(c.amount, cur)}</td><td>${pill(c.status)}</td></tr>`;
