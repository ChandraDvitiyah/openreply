import { clerkMiddleware } from "@clerk/nextjs/server";

// Loads Clerk's request context. Every protected database operation also checks
// auth beside the resource instead of trusting middleware alone.
export default clerkMiddleware();

export const config = {
  matcher: [
    // Keep the public health route outside Clerk entirely. Development Clerk
    // instances otherwise perform a browser handshake before the status HTML
    // can render, which also makes third-party uptime checks less reliable.
    "/((?!api/health(?:/|$)|_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api(?!/health(?:/|$))|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
