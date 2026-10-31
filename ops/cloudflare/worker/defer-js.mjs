// WC-TW-6l-3: request the booking page's Next.js chunks after first paint.
//
// The SSR shell (event title h1) paints at ~0.7 s observed, but Lighthouse's Lantern simulation puts every
// request that started before the observed LCP into the LCP dependency graph. The App Router head carries
// ~40 `<script async src=/_next/static/chunks/...>` tags plus `rel=preload as=script` links, so 500-700 KB of
// JS is requested before the h1 paints and simulated LCP lands at 4-7 s (WC-TW-6l-2 evidence).
//
// This transform, applied by the edge Worker to anonymous booking HTML only:
//   1. turns each async chunk script into an inert `<script type="text/tw-deferred" data-tw-src=...>`;
//   2. drops `<link rel="preload" as="script">` links;
//   3. appends a loader that re-creates the scripts as async in the task after first-contentful-paint
//      (PerformanceObserver 'paint'), immediately for a hidden tab, and at the latest 3 s after it runs.
// The chunks were async already, so execution order is unchanged in kind; hydration starts one frame later.
// The `noModule` polyfill script and inline scripts are left as they are.

const CHUNK_SCRIPT = /<script\b([^>]*?)\bsrc="(\/_next\/static\/chunks\/[^"]+\.js)"([^>]*)><\/script>/g;
const SCRIPT_PRELOAD = /<link\b(?=[^>]*\brel="preload")(?=[^>]*\bas="script")[^>]*>/g;

export const LOADER =
  "<script>(function(){var d=0;function go(){if(d)return;d=1;" +
  "var s=document.querySelectorAll('script[data-tw-src]');" +
  "for(var i=0;i<s.length;i++){var o=s[i],n=document.createElement('script');" +
  "n.src=o.getAttribute('data-tw-src');n.async=true;o.parentNode.replaceChild(n,o)}}" +
  "function fcp(){return performance.getEntriesByName('first-contentful-paint').length>0}" +
  "if(document.visibilityState==='hidden'||fcp())go();" +
  "else{try{new PerformanceObserver(function(){if(fcp())setTimeout(go,0)}).observe({type:'paint',buffered:true})}" +
  "catch(e){requestAnimationFrame(function(){setTimeout(go,0)})}}setTimeout(go,3000)})()</script>";

/** Rewrites one complete-tag segment of HTML. Exported for tests. */
export function deferSegment(html) {
  return html
    .replace(CHUNK_SCRIPT, (tag, pre, src, post) => {
      const attrs = `${pre} ${post}`;
      if (/\bnomodule\b/i.test(attrs) || !/\basync\b/.test(attrs)) return tag;
      return `<script type="text/tw-deferred" data-tw-src="${src}"></script>`;
    })
    .replace(SCRIPT_PRELOAD, "");
}

/**
 * Streams `body` through deferSegment, never splitting a tag across segments, and appends LOADER at the end
 * when at least one script was deferred (HTML without chunk scripts passes through byte-identical).
 * An unclosed tag or `<script>` element is carried into the next chunk (capped at 64 KB so a large inline
 * script or a stray `<` cannot buffer the page; chunk script elements are ~70 bytes).
 */
export function deferChunkScripts(body) {
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let carry = "";
  let deferred = false;
  const MAX_CARRY = 64 * 1024;
  const emit = (ctl, text, final) => {
    let s = carry + text;
    carry = "";
    if (!final) {
      // hold back an unclosed tag, or a <script> whose </script> has not arrived yet
      let cut = -1;
      const sc = s.lastIndexOf("<script");
      if (sc >= 0 && s.indexOf("</script>", sc) < 0) cut = sc;
      const lt = s.lastIndexOf("<");
      if (lt >= 0 && s.indexOf(">", lt) < 0 && (cut < 0 || lt < cut)) cut = lt;
      if (cut >= 0 && s.length - cut < MAX_CARRY) {
        carry = s.slice(cut);
        s = s.slice(0, cut);
      }
    }
    if (!s) return;
    const t = deferSegment(s);
    if (t.includes('type="text/tw-deferred"')) deferred = true;
    ctl.enqueue(enc.encode(t));
  };
  return body.pipeThrough(
    new TransformStream({
      transform(chunk, ctl) {
        emit(ctl, dec.decode(chunk, { stream: true }), false);
      },
      flush(ctl) {
        emit(ctl, dec.decode(), true);
        if (deferred) ctl.enqueue(enc.encode(LOADER));
      },
    })
  );
}
