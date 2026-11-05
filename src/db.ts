import Database from "better-sqlite3";
import crypto from "node:crypto";

const db = new Database(process.env.DB_PATH || "claims.db");
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS workspaces(
  id INTEGER PRIMARY KEY, name TEXT, token TEXT UNIQUE, password TEXT,
  currency TEXT DEFAULT 'INR', manager_email TEXT);
CREATE TABLE IF NOT EXISTS claims(
  id INTEGER PRIMARY KEY, workspace_id INTEGER, merchant TEXT, amount REAL,
  gst_amount REAL DEFAULT 0, gstin TEXT, date TEXT, category TEXT, description TEXT,
  claimant_name TEXT, status TEXT DEFAULT 'draft', approval_token TEXT UNIQUE,
  receipt_url TEXT, decision_comment TEXT, approver TEXT,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS claim_events(
  id INTEGER PRIMARY KEY, claim_id INTEGER, actor TEXT, action TEXT,
  old_value TEXT, new_value TEXT, at TEXT DEFAULT (datetime('now')));
`);

export type Claim = {
  id: number; workspace_id: number; merchant: string; amount: number; gst_amount: number;
  gstin: string | null; date: string; category: string; description: string | null;
  claimant_name: string; status: "draft" | "submitted" | "approved" | "rejected";
  approval_token: string; receipt_url: string | null; decision_comment: string | null;
  approver: string | null; created_at: string; updated_at: string;
};
export type Workspace = { id: number; name: string; token: string; password: string; currency: string; manager_email: string | null };

const rand = (n = 24) => crypto.randomBytes(n).toString("base64url");

export function ensureWorkspace(): Workspace {
  let w = db.prepare("SELECT * FROM workspaces LIMIT 1").get() as Workspace | undefined;
  if (!w) {
    const token = process.env.WORKSPACE_TOKEN || rand(24);
    const password = process.env.DEMO_PASSWORD || "demo1234";
    db.prepare("INSERT INTO workspaces(name,token,password,manager_email) VALUES(?,?,?,?)")
      .run("Demo Team", token, password, "manager@example.com");
    w = db.prepare("SELECT * FROM workspaces LIMIT 1").get() as Workspace;
  }
  return w;
}
export const wsByToken = (t: string) => db.prepare("SELECT * FROM workspaces WHERE token=?").get(t) as Workspace | undefined;
export const wsByLogin = (name: string, pw: string) =>
  db.prepare("SELECT * FROM workspaces WHERE lower(name)=lower(?) AND password=?").get(name, pw) as Workspace | undefined;

export function addEvent(claim_id: number, actor: string, action: string, old_value?: unknown, new_value?: unknown) {
  db.prepare("INSERT INTO claim_events(claim_id,actor,action,old_value,new_value) VALUES(?,?,?,?,?)")
    .run(claim_id, actor, action, old_value == null ? null : JSON.stringify(old_value), new_value == null ? null : JSON.stringify(new_value));
}

export type NewClaim = {
  merchant: string; amount: number; gst_amount?: number; gstin?: string; date: string;
  category: string; description?: string; claimant_name: string;
};

export function createClaim(ws: number, c: NewClaim, actor = "claude") {
  const dup = db.prepare(
    "SELECT id FROM claims WHERE workspace_id=? AND lower(merchant)=lower(?) AND amount=? AND date=? AND lower(claimant_name)=lower(?)"
  ).get(ws, c.merchant, c.amount, c.date, c.claimant_name) as { id: number } | undefined;
  if (dup) throw new Error(`Duplicate: claim #${dup.id} already has the same merchant, amount, date and claimant.`);
  const r = db.prepare(
    `INSERT INTO claims(workspace_id,merchant,amount,gst_amount,gstin,date,category,description,claimant_name,approval_token)
     VALUES(?,?,?,?,?,?,?,?,?,?)`
  ).run(ws, c.merchant, c.amount, c.gst_amount ?? 0, c.gstin ?? null, c.date, c.category, c.description ?? null, c.claimant_name, rand(18));
  const id = Number(r.lastInsertRowid);
  addEvent(id, actor, "created", null, c);
  return getClaim(ws, id)!;
}

export const getClaim = (ws: number, id: number) =>
  db.prepare("SELECT * FROM claims WHERE id=? AND workspace_id=?").get(id, ws) as Claim | undefined;
export const claimByApprovalToken = (t: string) =>
  db.prepare("SELECT * FROM claims WHERE approval_token=?").get(t) as Claim | undefined;
export const eventsFor = (id: number) =>
  db.prepare("SELECT * FROM claim_events WHERE claim_id=? ORDER BY id").all(id) as
    { actor: string; action: string; old_value: string | null; new_value: string | null; at: string }[];

export function listClaims(ws: number, f: { status?: string; claimant?: string; from?: string; to?: string; q?: string } = {}) {
  let sql = "SELECT * FROM claims WHERE workspace_id=?";
  const args: unknown[] = [ws];
  if (f.status) { sql += " AND status=?"; args.push(f.status); }
  if (f.claimant) { sql += " AND lower(claimant_name) LIKE ?"; args.push(`%${f.claimant.toLowerCase()}%`); }
  if (f.from) { sql += " AND date>=?"; args.push(f.from); }
  if (f.to) { sql += " AND date<=?"; args.push(f.to); }
  if (f.q) { sql += " AND (lower(merchant) LIKE ? OR lower(category) LIKE ?)"; args.push(`%${f.q.toLowerCase()}%`, `%${f.q.toLowerCase()}%`); }
  return db.prepare(sql + " ORDER BY id DESC").all(...args) as Claim[];
}

const EDITABLE = ["merchant", "amount", "gst_amount", "gstin", "date", "category", "description", "claimant_name"] as const;
export function updateClaim(ws: number, id: number, fields: Record<string, unknown>, actor: string) {
  const c = getClaim(ws, id);
  if (!c) throw new Error(`Claim #${id} not found.`);
  if (c.status === "approved" || c.status === "rejected") throw new Error(`Claim #${id} is already ${c.status} and can't be edited.`);
  const sets: string[] = []; const args: unknown[] = [];
  for (const k of EDITABLE) {
    if (fields[k] !== undefined && fields[k] !== (c as any)[k]) {
      addEvent(id, actor, `edited ${k}`, (c as any)[k], fields[k]);
      sets.push(`${k}=?`); args.push(fields[k]);
    }
  }
  if (sets.length) db.prepare(`UPDATE claims SET ${sets.join(",")}, updated_at=datetime('now') WHERE id=?`).run(...args, id);
  return getClaim(ws, id)!;
}

export function setReceipt(ws: number, id: number, url: string, actor: string) {
  if (!getClaim(ws, id)) throw new Error("Claim not found");
  db.prepare("UPDATE claims SET receipt_url=?, updated_at=datetime('now') WHERE id=?").run(url, id);
  addEvent(id, actor, "receipt attached", null, url);
}

export function submitClaim(ws: number, id: number, actor: string) {
  const c = getClaim(ws, id);
  if (!c) throw new Error(`Claim #${id} not found.`);
  if (c.status !== "draft") throw new Error(`Claim #${id} is ${c.status}; only drafts can be submitted.`);
  db.prepare("UPDATE claims SET status='submitted', updated_at=datetime('now') WHERE id=?").run(id);
  addEvent(id, actor, "submitted", "draft", "submitted");
  return getClaim(ws, id)!;
}

export function decide(token: string, approve: boolean, comment: string, approver: string) {
  const c = claimByApprovalToken(token);
  if (!c) throw new Error("Invalid link");
  if (c.status !== "submitted") throw new Error(`This claim is already ${c.status}.`);
  const st = approve ? "approved" : "rejected";
  db.prepare("UPDATE claims SET status=?, decision_comment=?, approver=?, updated_at=datetime('now') WHERE id=?")
    .run(st, comment || null, approver || "manager", c.id);
  addEvent(c.id, "manager", st, "submitted", { comment, approver });
}
