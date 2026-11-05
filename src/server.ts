import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as q from "./db.js";
import { buildMcp } from "./mcp.js";
import { esc, money, page, pill, claimRow, CATEGORIES } from "./ui.js";

const UPLOADS = process.env.UPLOAD_DIR || path.resolve("uploads");
fs.mkdirSync(UPLOADS, { recursive: true });
const MAX_MB = 20;
const upload = multer({ dest: UPLOADS, limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (_r, f, cb) => cb(null, /^(image\/|application\/pdf)/.test(f.mimetype)) });

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));
const base = (req: express.Request) => process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;

// ---------- MCP (stateless) ----------
app.post("/mcp/:token", async (req, res) => {
  const ws = q.wsByToken(req.params.token);
  if (!ws) return void res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Invalid workspace token" }, id: null });
  const server = buildMcp(ws, base(req));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
const noGet = (_: express.Request, res: express.Response) =>
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server)" }, id: null });
app.get("/mcp/:token", noGet); app.delete("/mcp/:token", noGet);

// ---------- Session (cookie holds workspace token) ----------
const cookie = (req: express.Request, k: string) =>
  { const v = req.headers.cookie?.split(";").map((s) => s.trim()).find((s) => s.startsWith(k + "="))?.slice(k.length + 1);
    try { return v === undefined ? undefined : decodeURIComponent(v); } catch { return undefined; } };
const auth: express.RequestHandler = (req, res, next) => {
  const ws = cookie(req, "ws") && q.wsByToken(cookie(req, "ws")!);
  if (!ws) return void res.redirect("/login");
  (res.locals as any).ws = ws; next();
};
const W = (res: express.Response) => (res.locals as any).ws as q.Workspace;

app.get("/health", (_r, res) => void res.send("ok"));
app.get("/login", (_r, res) => res.send(page("Log in", `<div class="card" style="max-width:380px;margin:60px auto">
<h2>Log in</h2><form method="post" action="/login"><label>Workspace</label><input name="name" value="Demo Team">
<label>Password</label><input name="password" type="password"><br><br><button>Log in</button></form></div>`, false)));
app.post("/login", (req, res) => {
  const ws = q.wsByLogin(req.body.name || "", req.body.password || "");
  if (!ws) return void res.status(401).send(page("Log in", `<div class="card">Wrong workspace or password. <a href="/login">Try again</a></div>`, false));
  res.setHeader("Set-Cookie", `ws=${encodeURIComponent(ws.token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000${req.secure ? "; Secure" : ""}`);
  res.redirect("/");
});
app.get("/logout", (_r, res) => { res.setHeader("Set-Cookie", "ws=; Path=/; Max-Age=0"); res.redirect("/login"); });

// ---------- Claims list ----------
app.get("/", auth, (req, res) => {
  const ws = W(res); const status = String(req.query.status || ""); const qs = String(req.query.q || "");
  const rows = q.listClaims(ws.id, { status: status || undefined, q: qs || undefined });
  const all = q.listClaims(ws.id);
  const sum = (s: string) => all.filter((c) => c.status === s).reduce((t, c) => t + c.amount, 0);
  res.send(page("Claims", `
<div class="card stats"><div><small>Pending approval</small><b>${money(sum("submitted"), ws.currency)}</b></div>
<div><small>Approved</small><b>${money(sum("approved"), ws.currency)}</b></div>
<div><small>Drafts</small><b>${all.filter((c) => c.status === "draft").length}</b></div></div>
<div class="card"><form class="row" method="get"><div><label>Search</label><input name="q" value="${esc(qs)}" placeholder="merchant or category"></div>
<div><label>Status</label><select name="status"><option value="">All</option>${["draft", "submitted", "approved", "rejected"].map((s) => `<option ${s === status ? "selected" : ""}>${s}</option>`).join("")}</select></div>
<div><button>Filter</button></div><div><a class="btn ghost" href="/claims/new">+ New claim</a></div></form></div>
<div class="card wrap"><table><tr><th>ID</th><th>Merchant</th><th>Claimant</th><th>Date</th><th>Category</th><th>Amount</th><th>Status</th></tr>
${rows.map((c) => claimRow(c, ws.currency)).join("") || `<tr><td colspan=7>No claims yet. Ask Claude to file a receipt.</td></tr>`}</table></div>`));
});

// ---------- New / edit ----------
const form = (c: Partial<q.Claim>, locked: boolean) => `
<div class="grid"><div><label>Merchant</label><input name="merchant" value="${esc(c.merchant)}" required ${locked ? "disabled" : ""}></div>
<div><label>Claimant</label><input name="claimant_name" value="${esc(c.claimant_name)}" required ${locked ? "disabled" : ""}></div>
<div><label>Amount (total)</label><input name="amount" type="number" step="0.01" value="${esc(c.amount)}" required ${locked ? "disabled" : ""}></div>
<div><label>GST amount</label><input name="gst_amount" type="number" step="0.01" value="${esc(c.gst_amount ?? 0)}" ${locked ? "disabled" : ""}></div>
<div><label>Date</label><input name="date" type="date" value="${esc(c.date)}" required ${locked ? "disabled" : ""}></div>
<div><label>Category</label><select name="category" ${locked ? "disabled" : ""}>${[...new Set([...CATEGORIES, c.category].filter(Boolean))].map((x) => `<option ${x === c.category ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div>
<div><label>GSTIN</label><input name="gstin" value="${esc(c.gstin)}" ${locked ? "disabled" : ""}></div>
<div><label>Description</label><input name="description" value="${esc(c.description)}" ${locked ? "disabled" : ""}></div></div>`;
const parse = (b: any) => ({ merchant: b.merchant, claimant_name: b.claimant_name, amount: Number(b.amount), gst_amount: Number(b.gst_amount || 0),
  date: b.date, category: b.category, gstin: b.gstin || undefined, description: b.description || undefined });

app.get("/claims/new", auth, (_r, res) => res.send(page("New claim", `<div class="card"><h2>New claim</h2><form method="post" action="/claims">${form({ date: new Date().toISOString().slice(0, 10) }, false)}<br><button>Create draft</button></form></div>`)));
app.post("/claims", auth, (req, res) => {
  try { res.redirect(`/claims/${q.createClaim(W(res).id, parse(req.body), "employee").id}`); }
  catch (e) { res.status(400).send(page("Error", `<div class="card">${esc((e as Error).message)} <a href="/claims/new">Back</a></div>`)); }
});

app.get("/claims/:id", auth, (req, res) => {
  const ws = W(res); const c = q.getClaim(ws.id, Number(req.params.id));
  if (!c) return void res.status(404).send(page("Not found", `<div class="card">Claim not found</div>`));
  const locked = c.status === "approved" || c.status === "rejected";
  const link = `${base(req)}/approve/${c.approval_token}`;
  res.send(page(`Claim #${c.id}`, `
<div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Claim #${c.id} · ${esc(c.merchant)}</h2><div style="flex:0">${pill(c.status)}</div></div>
${c.decision_comment ? `<p><b>Manager comment:</b> ${esc(c.decision_comment)}</p>` : ""}
<form method="post" action="/claims/${c.id}">${form(c, locked)}${locked ? "" : `<br><button>Save changes</button>`}</form></div>
${c.status === "draft" ? `<div class="card"><form method="post" action="/claims/${c.id}/submit"><b>Ready?</b> Submitting generates the manager's approval link. <button>Submit for approval</button></form></div>` : ""}
${c.status === "submitted" ? `<div class="card"><b>Manager approval link</b> (share this):<div class="copy">${esc(link)}</div><br><a class="btn ghost" href="/approve/${c.approval_token}" target="_blank">Open as manager</a></div>` : ""}
<div class="card"><b>Receipt</b>${c.receipt_url ? `<p><a href="${esc(c.receipt_url)}" target="_blank">${/\.pdf$/i.test(c.receipt_url) ? "View PDF" : `<img class="rcpt" src="${esc(c.receipt_url)}" alt="receipt">`}</a></p>` : "<p>No receipt attached yet.</p>"}
<form method="post" action="/claims/${c.id}/receipt" enctype="multipart/form-data"><input type="file" name="receipt" accept="image/*,application/pdf" required> <small>Image or PDF, up to ${MAX_MB}MB</small><br><br><button class="ghost">Upload receipt</button></form></div>
<div class="card"><b>Audit trail</b><ul class="tl">${q.eventsFor(c.id).map((e) => `<li><b>${esc(e.actor)}</b> ${esc(e.action)}${e.old_value && e.new_value && e.action.startsWith("edited") ? `: ${esc(e.old_value)} → ${esc(e.new_value)}` : ""} <small>${esc(e.at)} UTC</small></li>`).join("")}</ul></div>`));
});
app.post("/claims/:id", auth, (req, res) => {
  try { q.updateClaim(W(res).id, Number(req.params.id), parse(req.body), "employee"); res.redirect(`/claims/${req.params.id}`); }
  catch (e) { res.status(400).send(page("Error", `<div class="card">${esc((e as Error).message)}</div>`)); }
});
app.post("/claims/:id/submit", auth, (req, res) => {
  try { q.submitClaim(W(res).id, Number(req.params.id), "employee"); res.redirect(`/claims/${req.params.id}`); }
  catch (e) { res.status(400).send(page("Error", `<div class="card">${esc((e as Error).message)}</div>`)); }
});
const receiptUpload: express.RequestHandler = (req, res, next) =>
  upload.single("receipt")(req, res, (err: unknown) => {
    if (!err) return next();
    const msg = err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
      ? `That file is larger than ${MAX_MB}MB. Please upload a smaller photo or PDF.` : "Upload failed. Please try again.";
    res.status(400).send(page("Error", `<div class="card">${esc(msg)} <a href="/claims/${encodeURIComponent(req.params.id as string)}">Back to claim</a></div>`));
  });
app.post("/claims/:id/receipt", auth, receiptUpload, (req, res) => {
  if (!req.file) return void res.status(400).send(page("Error", `<div class="card">Upload an image or PDF (max ${MAX_MB}MB). <a href="/claims/${encodeURIComponent(req.params.id)}">Back to claim</a></div>`));
  const ext = req.file.mimetype === "application/pdf" ? ".pdf" : (path.extname(req.file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, "") || ".jpg");
  const name = crypto.randomBytes(12).toString("hex") + ext;
  fs.renameSync(req.file.path, path.join(UPLOADS, name));
  try { q.setReceipt(W(res).id, Number(req.params.id), `/receipts/${name}`, "employee"); res.redirect(`/claims/${req.params.id}`); }
  catch (e) { res.status(404).send(page("Error", `<div class="card">${esc((e as Error).message)}</div>`)); }
});
app.use("/receipts", express.static(UPLOADS, { index: false, dotfiles: "deny" }));

// ---------- Public manager approval ----------
app.get("/approve/:token", (req, res) => {
  const c = q.claimByApprovalToken(req.params.token);
  if (!c) return void res.status(404).send(page("Invalid link", `<div class="card">This approval link is invalid.</div>`, false));
  res.send(page("Approve claim", `<div class="card"><h2>Expense claim #${c.id}</h2><p>${pill(c.status)}</p>
<div class="grid"><div><small>Claimant</small><br><b>${esc(c.claimant_name)}</b></div><div><small>Merchant</small><br><b>${esc(c.merchant)}</b></div>
<div><small>Amount</small><br><b>${money(c.amount)}</b> <small>(GST ${money(c.gst_amount)})</small></div><div><small>Date / Category</small><br><b>${esc(c.date)} · ${esc(c.category)}</b></div></div>
${c.description ? `<p>${esc(c.description)}</p>` : ""}${c.receipt_url ? `<p><img class="rcpt" src="${esc(c.receipt_url)}" alt="receipt"></p>` : "<p><small>No receipt attached.</small></p>"}
${c.status === "submitted" ? `<form method="post"><label>Your name</label><input name="approver" required><label>Comment (optional)</label><textarea name="comment" rows="2"></textarea><br>
<button class="ok" name="decision" value="approve">Approve</button> <button class="bad" name="decision" value="reject">Reject</button></form>`
 : `<p>Decision: <b>${esc(c.status)}</b>${c.approver ? ` by ${esc(c.approver)}` : ""}${c.decision_comment ? ` — ${esc(c.decision_comment)}` : ""}</p>`}</div>`, false));
});
app.post("/approve/:token", (req, res) => {
  try { q.decide(req.params.token, req.body.decision === "approve", req.body.comment || "", req.body.approver || ""); res.redirect(`/approve/${req.params.token}`); }
  catch (e) { res.status(400).send(page("Error", `<div class="card">${esc((e as Error).message)}</div>`, false)); }
});

// ---------- CSV export + connect help ----------
app.get("/export.csv", auth, (req, res) => {
  const ws = W(res); const f = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`;
  const rows = q.listClaims(ws.id, { status: String(req.query.status || "approved") });
  const csv = ["id,date,claimant,merchant,category,amount,gst_amount,gstin,status,approver,comment",
    ...rows.map((c) => [c.id, c.date, c.claimant_name, c.merchant, c.category, c.amount, c.gst_amount, c.gstin, c.status, c.approver, c.decision_comment].map(f).join(","))].join("\n");
  res.type("text/csv").attachment("approved-claims.csv").send(csv);
});
app.get("/connect", auth, (req, res) => {
  const url = `${base(req)}/mcp/${encodeURIComponent(W(res).token)}`;
  res.send(page("Connect Claude", `<div class="card"><h2>Connect to Claude</h2><ol>
<li>In Claude, open <b>Settings → Connectors → Add custom connector</b>.</li><li>Name it <b>ClaimDesk</b> and paste this URL:</li></ol>
<div class="copy">${esc(url)}</div><p>Treat this URL like a password. Then try: <i>"File this receipt as a client lunch for Priya"</i> with a receipt photo attached.</p></div>`));
});

const ws = q.ensureWorkspace();
const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`ClaimDesk on :${port}`);
  console.log(`MCP path: /mcp/${encodeURIComponent(ws.token)}`);
});
