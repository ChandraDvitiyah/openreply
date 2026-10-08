export const READ_SCOPE = "kult:read";
export const WRITE_SCOPE = "kult:write";
export class AgentAuthError extends Error {
  constructor(message: string, public status: number, public challenge?: "insufficient_scope") { super(message); }
}
