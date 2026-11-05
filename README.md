# ClaimDesk: expense claims & approvals, powered by your own Claude plan
No AI inside: Claude reads receipts and calls the MCP tools; this app stores, edits, approves and exports.

## Run locally
    npm install && npm run dev     # prints the MCP path on startup; login: "Demo Team" / demo1234

## Deploy (Render)
Push to GitHub, create a Blueprint from render.yaml. In the Render env vars read WORKSPACE_TOKEN;
your MCP URL is https://<app>.onrender.com/mcp/<WORKSPACE_TOKEN>. Set BASE_URL if behind a custom domain.

## Connect to Claude
1. Claude → Settings → Connectors → Add custom connector
2. Name: ClaimDesk, URL: your MCP URL above
3. Try: "File this receipt as a client lunch for Priya" (attach a photo), then "Submit it", then "What's pending?"

## MCP tools
create_claim, list_claims, get_claim, update_claim, submit_claim

## Known next steps
Email notifications, OAuth per user, multi-level approvals, receipt upload straight from chat.
