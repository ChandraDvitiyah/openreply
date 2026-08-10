import { getBaseUrl, getMetaGraphApiVersion, requireEnv } from "@/lib/env";

const FACEBOOK_OAUTH_BASE = "https://www.facebook.com";
const FACEBOOK_GRAPH_BASE = "https://graph.facebook.com";

type FacebookErrorBody = {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

async function readFacebookResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & FacebookErrorBody;
  if (!response.ok || body.error) {
    const error = body.error;
    const code = error?.code ? ` ${error.code}` : "";
    throw new Error(`Facebook API${code}: ${error?.message ?? response.statusText}`);
  }
  return body;
}

function graphUrl(path: string) {
  return `${FACEBOOK_GRAPH_BASE}/${getMetaGraphApiVersion()}/${path}`;
}

export function getFacebookAuthorizationUrl(state: string) {
  const redirectUri = `${getBaseUrl()}/api/facebook/callback`;
  const params = new URLSearchParams({
    client_id: requireEnv("FACEBOOK_APP_ID"),
    redirect_uri: redirectUri,
    state,
    response_type: "code",
    scope: [
      "pages_show_list",
      "pages_manage_metadata",
      "pages_read_engagement",
      "pages_manage_engagement",
      "pages_messaging",
    ].join(","),
  });
  return `${FACEBOOK_OAUTH_BASE}/${getMetaGraphApiVersion()}/dialog/oauth?${params}`;
}

export async function exchangeFacebookCode(code: string) {
  const params = new URLSearchParams({
    client_id: requireEnv("FACEBOOK_APP_ID"),
    client_secret: requireEnv("FACEBOOK_APP_SECRET"),
    redirect_uri: `${getBaseUrl()}/api/facebook/callback`,
    code,
  });
  const response = await fetch(
    `${FACEBOOK_GRAPH_BASE}/${getMetaGraphApiVersion()}/oauth/access_token?${params}`
  );
  return readFacebookResponse<{ access_token: string; expires_in?: number }>(response);
}

export async function getLongLivedFacebookToken(shortLivedToken: string) {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: requireEnv("FACEBOOK_APP_ID"),
    client_secret: requireEnv("FACEBOOK_APP_SECRET"),
    fb_exchange_token: shortLivedToken,
  });
  const response = await fetch(
    `${FACEBOOK_GRAPH_BASE}/${getMetaGraphApiVersion()}/oauth/access_token?${params}`
  );
  return readFacebookResponse<{ access_token: string; expires_in?: number }>(response);
}

export type ManagedFacebookPage = {
  id: string;
  name: string;
  access_token: string;
};

export async function getManagedFacebookPages(userAccessToken: string) {
  const params = new URLSearchParams({
    fields: "id,name,access_token",
    limit: "100",
    access_token: userAccessToken,
  });
  const response = await fetch(`${graphUrl("me/accounts")}?${params}`);
  const body = await readFacebookResponse<{ data?: ManagedFacebookPage[] }>(response);
  return (body.data ?? []).filter(
    (page) => Boolean(page.id && page.name && page.access_token)
  );
}

export async function subscribeFacebookPage(pageId: string, pageAccessToken: string) {
  const params = new URLSearchParams({
    subscribed_fields: "messages,messaging_postbacks,feed",
    access_token: pageAccessToken,
  });
  const response = await fetch(`${graphUrl(`${pageId}/subscribed_apps`)}?${params}`, {
    method: "POST",
  });
  return readFacebookResponse<{ success: boolean }>(response);
}

export async function sendFacebookMessage(
  pageId: string,
  pageAccessToken: string,
  recipientId: string,
  message: string
) {
  const response = await fetch(graphUrl(`${pageId}/messages`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${pageAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recipient: { id: recipientId },
      messaging_type: "RESPONSE",
      message: { text: message },
    }),
  });
  return readFacebookResponse<{ recipient_id: string; message_id: string }>(response);
}

export async function sendFacebookCommentPrivateReply(
  commentId: string,
  pageAccessToken: string,
  message: string
) {
  const response = await fetch(graphUrl(`${commentId}/private_replies`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${pageAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message }),
  });
  return readFacebookResponse<{ id?: string; message_id?: string }>(response);
}

export type FacebookPagePost = {
  id: string;
  created_time: string;
  message?: string;
  permalink_url?: string;
  full_picture?: string;
  shares?: { count?: number };
  comments?: { summary?: { total_count?: number } };
  reactions?: { summary?: { total_count?: number } };
  attachments?: {
    data?: Array<{
      media_type?: string;
      type?: string;
      title?: string;
      url?: string;
      target?: { id?: string; url?: string };
      media?: { image?: { src?: string } };
    }>;
  };
};

export async function getFacebookPagePosts(
  pageId: string,
  pageAccessToken: string,
  since: Date,
  max = 200
) {
  const posts: FacebookPagePost[] = [];
  const first = new URL(graphUrl(`${pageId}/posts`));
  first.searchParams.set(
    "fields",
    "id,created_time,message,permalink_url,full_picture,shares,comments.limit(0).summary(true),reactions.limit(0).summary(true),attachments{media_type,type,title,url,target,media}"
  );
  first.searchParams.set("limit", "100");
  first.searchParams.set("since", Math.floor(since.getTime() / 1000).toString());
  first.searchParams.set("access_token", pageAccessToken);

  let next: string | null = first.toString();
  while (next && posts.length < max) {
    const response: Response = await fetch(next);
    const body = await readFacebookResponse<{
      data?: FacebookPagePost[];
      paging?: { next?: string };
    }>(response);
    posts.push(...(body.data ?? []));
    next = body.paging?.next ?? null;
  }
  return posts.slice(0, max);
}

/**
 * Meta has renamed Page post-view metrics across Graph API versions. Try the
 * current media-view name first and gracefully fall back to the legacy video
 * metric so one unavailable metric never hides the rest of a post's data.
 */
export async function getFacebookPostViews(
  postId: string,
  pageAccessToken: string
): Promise<number | null> {
  const metrics = ["post_media_view", "post_media_views", "post_video_views"];

  for (const metric of metrics) {
    const url = new URL(graphUrl(`${postId}/insights`));
    url.searchParams.set("metric", metric);
    url.searchParams.set("period", "lifetime");
    url.searchParams.set("access_token", pageAccessToken);

    try {
      const response = await fetch(url.toString());
      const body = await readFacebookResponse<{
        data?: Array<{ values?: Array<{ value?: number }> }>;
      }>(response);
      const value = body.data?.[0]?.values?.[0]?.value;
      if (typeof value === "number") return value;
    } catch {
      // Try the next version-compatible metric name.
    }
  }

  return null;
}

export async function getFacebookPageInsightTotal(
  pageId: string,
  pageAccessToken: string,
  metric: string,
  since: Date,
  until: Date
): Promise<number | null> {
  const url = new URL(graphUrl(`${pageId}/insights`));
  url.searchParams.set("metric", metric);
  url.searchParams.set("period", "day");
  url.searchParams.set("since", Math.floor(since.getTime() / 1000).toString());
  url.searchParams.set("until", Math.floor(until.getTime() / 1000).toString());
  url.searchParams.set("access_token", pageAccessToken);

  try {
    const response = await fetch(url.toString());
    const body = await readFacebookResponse<{
      data?: Array<{ values?: Array<{ value?: number }> }>;
    }>(response);
    return (body.data?.[0]?.values ?? []).reduce(
      (sum, point) => sum + Number(point.value ?? 0),
      0
    );
  } catch (error) {
    // Page Insights metrics change independently across Graph API versions.
    // A missing metric should not hide reactions/comments/DM performance.
    console.warn(`[Facebook Insights] ${metric} unavailable`, error);
    return null;
  }
}
