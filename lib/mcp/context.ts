import { AsyncLocalStorage } from "node:async_hooks";
import type { WorkspaceContext } from "@/lib/workspace-access";

// Only the MCP dispatcher enters this context after credential verification.
// Never populate it from client-supplied user/workspace headers or tool inputs.
export const agentContext = new AsyncLocalStorage<WorkspaceContext>();
