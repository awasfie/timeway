"use client";

import type { UIEvent } from "react";
import { useEffect, useRef, useState } from "react";

// Own module so the booker (event-meta/Duration) can use it without pulling AllApps/AppCard,
// which import markdownToSafeHTML (markdown-it + sanitize-html) into the booking bundle.
export function useShouldShowArrows() {
  const ref = useRef<HTMLUListElement>(null);
  const [showArrowScroll, setShowArrowScroll] = useState({
    left: false,
    right: false,
  });

  useEffect(() => {
    const appCategoryList = ref.current;
    if (appCategoryList) {
      const isAtStart = appCategoryList.scrollLeft <= 0;
      const isAtEnd = appCategoryList.scrollWidth <= appCategoryList.clientWidth + appCategoryList.scrollLeft;
      setShowArrowScroll({
        left: !isAtStart,
        right: !isAtEnd,
      });
    }
  }, [ref.current?.scrollWidth, ref.current?.clientWidth]);

  const calculateScroll = (e: UIEvent<HTMLUListElement>) => {
    const target = e.currentTarget;
    const isAtEnd = target.scrollWidth <= target.clientWidth + target.scrollLeft + 1;
    setShowArrowScroll({
      left: target.scrollLeft > 0,
      right: !isAtEnd,
    });
  };

  return { ref, calculateScroll, leftVisible: showArrowScroll.left, rightVisible: showArrowScroll.right };
}
