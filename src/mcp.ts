import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as q from "./db.js";
import type { Workspace } from "./db.js";

const text = (o: unknown) => ({ content: [{ type: "text" as const, text: typeof o === "string" ? o : JSON.stringify(o, null, 2) }] });
const fail = (e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: (e as Error).message }] });
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const CATS = "Meals, Travel, Accommodation, Software, Office Supplies, Client Entertainment, Fuel, Other";

export function buildMcp(ws: Workspace, base: string) {
  const s = new McpServer({ name: "expense-claims", version: "1.0.0" });
  const withLinks = (c: q.Claim) => ({
    ...c, approval_token: undefined,
    edit_link: `${base}/claims/${c.id}`,
    manager_approval_link: c.status === "submitted" ? `${base}/approve/${c.approval_token}` : undefined,
  });

  s.registerTool("create_claim", {
    description:
      "Create a DRAFT expense claim. First read the receipt image/text yourself and extract every field below, then call this. " +
      "Do not guess: if amount, merchant or date is unreadable, ask the user. Dates must be YYYY-MM-DD. " +
      `Pick the closest category from: ${CATS}. Amounts are plain numbers (no currency symbol), gst_amount is the GST/tax portion included in the total. ` +
      "Returns the claim id and an edit link where the user can attach the receipt file and review.",
    inputSchema: {
      merchant: z.string().min(1).describe("Vendor name on the receipt"),
      amount: z.number().positive().describe("Total paid, including tax"),
      gst_amount: z.number().min(0).optional().describe("GST/tax portion of the total"),
      gstin: z.string().optional().describe("Merchant GSTIN if printed"),
      date: z.string().regex(dateRe, "Use YYYY-MM-DD").describe("Receipt date"),
      category: z.string().min(1).describe(`One of: ${CATS}`),
      description: z.string().optional().describe("Business purpose, e.g. 'Client lunch with Acme'"),
      claimant_name: z.string().min(1).describe("Name of the employee claiming"),
    },
  }, async (a) => { try { return text(withLinks(q.createClaim(ws.id, a))); } catch (e) { return fail(e); } });

  s.registerTool("list_claims", {
    description: "List expense claims, newest first. Use to answer questions like 'what's pending?' or 'what did Priya claim this month?'. All filters optional.",
    inputSchema: {
      status: z.enum(["draft", "submitted", "approved", "rejected"]).optional(),
      claimant: z.string().optional().describe("Partial name match"),
      from: z.string().regex(dateRe).optional(), to: z.string().regex(dateRe).optional(),
    },
  }, async (a) => {
    const rows = q.listClaims(ws.id, a);
    return text({ count: rows.length, total_amount: rows.reduce((t, c) => t + c.amount, 0), claims: rows.map(withLinks) });
  });

  s.registerTool("get_claim", {
    description: "Get one claim with its full audit history (who changed what, and when).",
    inputSchema: { id: z.number().int() },
  }, async ({ id }) => {
    const c = q.getClaim(ws.id, id);
    return c ? text({ claim: withLinks(c), history: q.eventsFor(id) }) : fail(new Error(`Claim #${id} not found.`));
  });

  s.registerTool("update_claim", {
    description: "Edit fields of a draft or submitted claim (not approved/rejected ones). Pass only the fields that change. Changes are logged in the audit trail.",
    inputSchema: {
      id: z.number().int(),
      merchant: z.string().optional(), amount: z.number().positive().optional(), gst_amount: z.number().min(0).optional(),
      gstin: z.string().optional(), date: z.string().regex(dateRe).optional(), category: z.string().optional(),
      description: z.string().optional(), claimant_name: z.string().optional(),
    },
  }, async ({ id, ...f }) => { try { return text(withLinks(q.updateClaim(ws.id, id, f, "claude"))); } catch (e) { return fail(e); } });

  s.registerTool("submit_claim", {
    description: "Submit a draft claim for approval. Returns a manager_approval_link to share with the approver. Only submit after the user confirms the details are right.",
    inputSchema: { id: z.number().int() },
  }, async ({ id }) => { try { return text(withLinks(q.submitClaim(ws.id, id, "claude"))); } catch (e) { return fail(e); } });

  return s;
}
