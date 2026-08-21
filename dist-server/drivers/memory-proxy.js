// Capability-scoped MCP proxy for durable agent memory. The harness fixes
// bot/thread/run provenance behind an opaque per-turn bearer capability; the
// agent can neither choose another bot nor mark a revision as used.
import readline from "node:readline";
const HARNESS = process.env.CUMEA_HARNESS_URL ?? "http://127.0.0.1:8799";
const CAPABILITY = process.env.CUMEA_MEMORY_CAPABILITY ?? "";
const TOOLS = [
    {
        name: "search_memory",
        description: "Search this agent's durable memory for relevant user-approved notes. Use before claiming you remember a preference or prior fact.",
        inputSchema: {
            type: "object",
            properties: { query: { type: "string", description: "A short factual search query." } },
            required: ["query"],
        },
    },
    {
        name: "remember",
        description: "Create or revise a durable Markdown memory for this agent. This is a persistent write and should be used only when the user explicitly asks to remember something or clearly confirms a durable preference. Never store credentials, private keys, or transient task chatter.",
        inputSchema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Relative Markdown path, for example preferences.md." },
                content: { type: "string", description: "The complete new content for this memory note." },
                pinned: { type: "boolean", description: "Always consider this note on future turns." },
            },
            required: ["path", "content"],
        },
    },
];
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const ok = (id, result) => send({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });
const textResult = (id, text, isError = false) => ok(id, { content: [{ type: "text", text }], isError });
async function api(path, init) {
    const response = await fetch(`${HARNESS}${path}`, {
        ...init,
        headers: { "content-type": "application/json", authorization: `Bearer ${CAPABILITY}`, ...(init?.headers ?? {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
        throw new Error(String(body.error ?? `HTTP ${response.status}`));
    return body;
}
async function callTool(name, args) {
    if (name === "search_memory") {
        const query = String(args.query ?? "").trim();
        if (!query)
            return { text: "search_memory needs a query.", isError: true };
        const body = await api(`/api/internal/memory/search?q=${encodeURIComponent(query)}`);
        const documents = Array.isArray(body.documents) ? body.documents : [];
        if (!documents.length)
            return { text: "No relevant durable memory found." };
        return {
            text: documents.map((document) => `### ${document.path} (revision ${document.revision})\n${document.content}`).join("\n\n"),
        };
    }
    if (name === "remember") {
        const path = String(args.path ?? "").trim();
        const content = String(args.content ?? "").trim();
        if (!path || !content)
            return { text: "remember needs path and content.", isError: true };
        const body = await api("/api/internal/memory/remember", {
            method: "POST",
            body: JSON.stringify({ path, content, ...(typeof args.pinned === "boolean" ? { pinned: args.pinned } : {}) }),
        });
        const document = body.document;
        return { text: `Saved ${document?.path ?? path} as revision ${document?.revision ?? "unknown"}.` };
    }
    return { text: `Unknown tool: ${name}`, isError: true };
}
async function handle(message) {
    const id = message.id;
    const method = message.method;
    if (!method)
        return;
    const params = (message.params ?? {});
    switch (method) {
        case "initialize":
            ok(id, {
                protocolVersion: params.protocolVersion ?? "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "cumea-memory", version: "0.2.0" },
            });
            return;
        case "notifications/initialized":
        case "notifications/cancelled":
            return;
        case "ping":
            ok(id, {});
            return;
        case "tools/list":
            ok(id, { tools: TOOLS });
            return;
        case "tools/call": {
            const name = String(params.name ?? "");
            if (!TOOLS.some((tool) => tool.name === name))
                return rpcError(id, -32602, `Unknown tool: ${name}`);
            try {
                const result = await callTool(name, (params.arguments ?? {}));
                textResult(id, result.text, result.isError);
            }
            catch (error) {
                textResult(id, error instanceof Error ? error.message : String(error), true);
            }
            return;
        }
        default:
            if (id !== undefined)
                rpcError(id, -32601, `Method not found: ${method}`);
    }
}
const input = readline.createInterface({ input: process.stdin, terminal: false });
input.on("line", (line) => {
    const text = line.trim();
    if (!text || text.length > 256 * 1024)
        return;
    let message;
    try {
        message = JSON.parse(text);
    }
    catch {
        return;
    }
    void handle(message).catch((error) => {
        if (message.id !== undefined)
            rpcError(message.id, -32603, error instanceof Error ? error.message : String(error));
    });
});
input.on("close", () => process.exit(0));
