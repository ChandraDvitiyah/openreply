import { getBioLink, recordBioLinkClick } from "@/lib/bio-db";

function appStoreInterstitial(storeUrl: string, source: "instagram" | "facebook") {
  const safeUrl = JSON.stringify(storeUrl).replace(/</g, "\\u003c");
  const safeSource = JSON.stringify(source);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Opening the App Store…</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f4efe6;color:#17120f;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}.card{width:min(100%,420px);background:#fff;border:1px solid #e2d9ce;border-radius:28px;padding:30px;box-shadow:0 25px 70px rgba(55,36,20,.13);text-align:center}.mark{display:grid;place-items:center;width:56px;height:56px;margin:0 auto 22px;border-radius:17px;background:#ff5c35;color:#fff;font-size:24px;font-weight:800;transform:rotate(-4deg)}h1{margin:0;font-size:27px;letter-spacing:-.04em}p{color:#6d625b;line-height:1.6}.cta{display:block;margin-top:22px;padding:15px 18px;border-radius:999px;background:#17120f;color:#fff;text-decoration:none;font-weight:700}.fallback{display:none;margin-top:22px;padding:18px;border-radius:18px;background:#f6f1ea;text-align:left;font-size:14px}.fallback strong{display:block;margin-bottom:6px}.copy{margin-top:12px;border:0;background:transparent;color:#d84724;font-weight:700;cursor:pointer}
</style></head><body><main class="card"><div class="mark">K</div><h1>Opening the App Store</h1><p>Instagram sometimes keeps store links trapped inside its browser. We’re opening this one safely.</p><a id="open" class="cta" href=${safeUrl}>Open in App Store</a><div id="fallback" class="fallback"><strong>Still here?</strong>Tap ⋯ at the top right, then choose “Open in external browser.”<button id="copy" class="copy" type="button">Copy App Store link</button></div></main><script>
const target=${safeUrl},source=${safeSource};let left=false,timer;const markLeft=()=>{left=true};addEventListener('visibilitychange',()=>{if(document.hidden)markLeft()});addEventListener('pagehide',markLeft);addEventListener('blur',markLeft);
function attempt(e){if(e)e.preventDefault();left=false;clearTimeout(timer);if(source==='facebook'){window.open('x-safari-'+target,'_blank')}else{location.href='instagram://extbrowser/?url='+encodeURIComponent(target)}timer=setTimeout(()=>{if(!left)document.getElementById('fallback').style.display='block'},1500)}
document.getElementById('open').addEventListener('click',attempt);document.getElementById('copy').addEventListener('click',async()=>{await navigator.clipboard.writeText(target);document.getElementById('copy').textContent='Copied'});setTimeout(()=>attempt(),300);
</script></body></html>`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const link = await getBioLink(id);
  if (!link) return new Response("Link not found", { status: 404 });

  const userAgent = request.headers.get("user-agent") ?? "";
  const ua = userAgent.toLowerCase();
  const referrer = request.headers.get("referer") ?? "";
  await recordBioLinkClick(id, userAgent, referrer);

  const isIos = /iphone|ipad/.test(ua);
  const isThreads = ua.includes("barcelona");
  const isInstagram = !isThreads && ua.includes("instagram");
  const isFacebook = ua.includes("fban") || ua.includes("fbav") || ua.includes("fb_iab");
  const isAndroid = ua.includes("android");

  const destination = link.smartAppLink
    ? isIos && link.iosUrl
      ? link.iosUrl
      : isAndroid && link.androidUrl
        ? link.androidUrl
        : link.url
    : link.url;

  const isAppleStore = destination.startsWith("https://apps.apple.com/");
  if (link.smartAppLink && isIos && isAppleStore && (isInstagram || isThreads || isFacebook)) {
    return new Response(appStoreInterstitial(destination, isFacebook ? "facebook" : "instagram"), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; img-src data:; base-uri 'none'; form-action 'none'",
      },
    });
  }

  return Response.redirect(destination, 302);
}
