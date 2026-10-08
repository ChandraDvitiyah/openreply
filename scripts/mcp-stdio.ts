// Adapter for MCP clients that support stdio but cannot configure HTTP headers.
// Tokens come from the client's secret environment, never command arguments.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

async function main() {
  const token = process.env.KULT_MCP_TOKEN;
  const endpoint = process.env.KULT_MCP_URL;
  if (!token || !endpoint) throw new Error("Set KULT_MCP_TOKEN and KULT_MCP_URL in your MCP client's secret environment.");
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/api/mcp" ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))))
    throw new Error("KULT_MCP_URL must be an HTTPS /api/mcp endpoint (HTTP is allowed on loopback for development).");
  const http = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${token}` }, redirect: "error" },
  });
  const stdio = new StdioServerTransport();
  const fail = () => { process.stderr.write("Kult MCP connection failed. Check the endpoint, credential and service availability.\n"); process.exitCode = 1; void http.close(); void stdio.close(); };
  stdio.onmessage = (message) => { void http.send(message).catch(fail); };
  http.onmessage = (message) => { void stdio.send(message).catch(fail); };
  http.onerror = fail;
  stdio.onerror = fail;
  stdio.onclose = () => { void http.close(); };
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { void http.close(); void stdio.close(); });
  await http.start();
  await stdio.start();
}
main().catch(() => { process.stderr.write("Kult MCP could not start. Set KULT_MCP_TOKEN and a valid KULT_MCP_URL.\n"); process.exitCode = 1; });
