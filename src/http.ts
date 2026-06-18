import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer } from "./server.js";

/**
 * HTTP entry point: serves the GlassHive MCP server over the Streamable HTTP
 * transport at POST /mcp. This is what remote hosts (Smithery, etc.) talk to.
 *
 * Runs in stateless mode — a fresh server + transport per request — which keeps
 * the deployment horizontally scalable and avoids cross-request session state.
 *
 * The GlassHive API key is read from process.env.GLASSHIVE_API_KEY (see
 * src/client.ts), so set it as an environment variable / secret on the host.
 */

const app = express();
app.use(express.json());

// Lightweight health check for the platform.
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

app.post("/mcp", async (req: Request, res: Response) => {
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      // Stateless: no session id, no server-side session storage.
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("Error handling MCP request:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// Stateless mode does not support the GET (SSE) or DELETE (session teardown) verbs.
const methodNotAllowed = (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
};
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => {
  // Log to stderr so it never interferes with any stdio JSON-RPC consumers.
  console.error(`glasshive-mcp HTTP server listening on :${port}/mcp`);
});
