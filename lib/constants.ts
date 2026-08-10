/**
 * Shared limits used by both the API validation schemas and the client-side
 * campaign builder / import UI, so the two never drift apart.
 */

// Maximum number of keywords a campaign can filter on. Keywords are matched
// locally (see lib/utils/keyword-matcher.ts), so this is a safety bound against
// oversized payloads rather than a Meta/Instagram constraint.
export const MAX_KEYWORDS = 50;

// This is real saved/sent content, not merely an input placeholder. Keeping it
// shared prevents an enabled public reply from silently carrying no message.
export const DEFAULT_PUBLIC_REPLY_MESSAGE = "Sent you a DM! 📩";
