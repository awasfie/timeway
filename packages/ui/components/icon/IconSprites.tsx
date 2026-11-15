"use client";

import { useEffect, useRef } from "react";

// eslint-disable-next-line turbo/no-undeclared-env-vars
const vercelCommitHash = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;
const commitHash = vercelCommitHash ? `-${vercelCommitHash.slice(0, 7)}` : "";

// WC-TW-6n-3: inline the icon sprite with a plain fetch instead of react-inlinesvg (+ react-from-dom),
// which sat on every route's first load. Same behaviour as before: fetched once after mount and
// inlined into the document so <use href="#name"> resolves.
let spriteMarkup: Promise<string> | null = null;

export function IconSprites() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const src = `${process.env.NEXT_PUBLIC_WEBAPP_URL}/icons/sprite.svg?v=${process.env.NEXT_PUBLIC_CALCOM_VERSION}-${commitHash}`;
    spriteMarkup ??= fetch(src)
      .then((res) => (res.ok ? res.text() : ""))
      .catch(() => "");
    let cancelled = false;
    void spriteMarkup.then((markup) => {
      const el = ref.current;
      if (cancelled || !el || !markup) return;
      const svg = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement;
      if (svg.nodeName.toLowerCase() !== "svg") return;
      el.replaceChildren(document.importNode(svg, true));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return <span ref={ref} aria-hidden="true" style={{ display: "contents" }} />;
}

export default IconSprites;
