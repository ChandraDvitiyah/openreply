import { clerkMiddleware } from "@clerk/nextjs/server";

// Loads Clerk's request context. Every protected database operation also checks
// auth beside the resource instead of trusting middleware alone.
export default clerkMiddleware();

export const config = {
  matcher: [
    // MCP verifies bearer credentials itself; browser Clerk handshakes must never
    // intercept its machine requests. Key management still goes through Clerk.
    // Keep the public health route outside Clerk entirely. Development Clerk
    // instances otherwise perform a browser handshake before the status HTML
    // can render, which also makes third-party uptime checks less reliable.
    "/((?!api/(?:health|mcp)(?:/|$)|\\.well-known/oauth-protected-resource(?:/|$)|_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api(?!/(?:health|mcp)(?:/|$))|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
