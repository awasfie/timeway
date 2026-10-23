"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { embedStore } from "./lib/embedStore";
import { isBrowser, log } from "./lib/utils";
import { sdkActionManager } from "../sdk-event";
import type {
  UiConfig,
  EmbedNonStylesConfig,
  EmbedStyles,
  EmbedBookerState,
  SlotsQuery,
  SetStyles,
  setNonStylesConfig,
} from "../types";
import { useCompatSearchParams } from "../useCompatSearchParams";

// The iframe<->parent runtime (message listener, methods, main()) lives in ../embed-iframe.ts and is
// loaded only inside an embed, so a regular booking page does not ship it (WC-TW-6c-9c).

// We don't import it from Booker/types because the types from this module are published to npm and we can't import packages that aren't published
type BookerState = "loading" | "selecting_date" | "selecting_time" | "booking";

declare global {
  interface Window {
    CalEmbed: {
      __logQueue?: unknown[];
      embedStore: typeof embedStore;
      applyCssVars: (cssVarsPerTheme: UiConfig["cssVarsPerTheme"]) => void;
    };
    // Marks that Booker has moved to some non-"loading" state
    _embedBookerState?: EmbedBookerState;
  }
}

if (isBrowser) {
  window.CalEmbed = window?.CalEmbed || {};
  window.CalEmbed.embedStore = embedStore;
}

const registerNewSetter = (
  registration:
    | {
        elementName: keyof EmbedStyles;
        setState: SetStyles;
        styles: true;
      }
    | {
        elementName: keyof EmbedNonStylesConfig;
        setState: setNonStylesConfig;
        styles: false;
      }
) => {
  // It's possible that 'ui' instruction has already been processed and the registration happened due to some action by the user in iframe.
  // So, we should call the setter immediately with available embedStyles
  if (registration.styles) {
    embedStore.reactStylesStateSetters[
      registration.elementName as keyof EmbedStyles
    ] = registration.setState;
    registration.setState(embedStore.styles || {});
    return () => {
      delete embedStore.reactStylesStateSetters[registration.elementName];
    };
  } else {
    embedStore.reactNonStylesStateSetters[
      registration.elementName as keyof EmbedNonStylesConfig
    ] = registration.setState;
    registration.setState(embedStore.nonStyles || {});

    return () => {
      delete embedStore.reactNonStylesStateSetters[registration.elementName];
    };
  }
};

function isValidNamespace(ns: string | null | undefined) {
  return typeof ns !== "undefined" && ns !== null;
}

/**
 * It handles any URL change done through Web history API as well
 * History API is currently being used by Booker/utils/query-param
 */
const useUrlChange = (callback: (newUrl: string) => void) => {
  const currentFullUrl = isBrowser ? new URL(document.URL) : null;
  const pathname = currentFullUrl?.pathname ?? "";
  const searchParams = currentFullUrl?.searchParams ?? null;
  const lastKnownUrl = useRef(`${pathname}?${searchParams}`);
  useEffect(() => {
    const newUrl = `${pathname}?${searchParams}`;
    if (lastKnownUrl.current !== newUrl) {
      lastKnownUrl.current = newUrl;
      callback(newUrl);
    }
  }, [pathname, searchParams, callback]);
};

export const useEmbedTheme = () => {
  const searchParams = useCompatSearchParams();
  const [theme, setTheme] = useState(
    embedStore.theme || (searchParams?.get("theme") as typeof embedStore.theme)
  );

  const onUrlChange = useCallback(() => {
    sdkActionManager?.fire("__routeChanged", {});
  }, []);
  useUrlChange(onUrlChange);

  embedStore.setTheme = setTheme;
  return theme;
};

/**
 * It serves following purposes
 * - Gives consistent values for ui config even after Soft Navigation. When a new React component mounts, it would ensure that the component gets the correct value of ui config
 * - Ensures that all the components using useEmbedUiConfig are updated when ui config changes. It is done by maintaining a list of all non-stale setters.
 */
export const useEmbedUiConfig = () => {
  const [uiConfig, setUiConfig] = useState(embedStore.uiConfig || {});
  embedStore.setUiConfig.push(setUiConfig);
  useEffect(() => {
    return () => {
      const foundAtIndex = embedStore.setUiConfig.findIndex(
        (item) => item === setUiConfig
      );
      // Keep removing the setters that are stale
      embedStore.setUiConfig.splice(foundAtIndex, 1);
    };
  });
  return uiConfig;
};

// TODO: Make it usable as an attribute directly instead of styles value. It would allow us to go beyond styles e.g. for debugging we can add a special attribute identifying the element on which UI config has been applied
export const useEmbedStyles = (elementName: keyof EmbedStyles) => {
  const [, setStyles] = useState<EmbedStyles>({});

  useEffect(() => {
    return registerNewSetter({
      elementName,
      setState: setStyles,
      styles: true,
    });
  }, []);
  const styles = embedStore.styles || {};
  // Always read the data from global embedStore so that even across components, the same data is used.
  return styles[elementName] || {};
};

export const useEmbedNonStylesConfig = (
  elementName: keyof EmbedNonStylesConfig
) => {
  const [, setNonStyles] = useState({} as EmbedNonStylesConfig);

  useEffect(() => {
    return registerNewSetter({
      elementName,
      setState: setNonStyles,
      styles: false,
    });
  }, []);

  // Always read the data from global embedStore so that even across components, the same data is used.
  const nonStyles = embedStore.nonStyles || {};
  return nonStyles[elementName] || {};
};

export const useIsBackgroundTransparent = () => {
  let isBackgroundTransparent = false;
  // TODO: Background should be read as ui.background and not ui.body.background
  const bodyEmbedStyles = useEmbedStyles("body");

  if (bodyEmbedStyles.background === "transparent") {
    isBackgroundTransparent = true;
  }
  return isBackgroundTransparent;
};

export const useBrandColors = () => {
  // TODO: Branding shouldn't be part of ui.styles. It should exist as ui.branding.
  const brandingColors = useEmbedNonStylesConfig(
    "branding"
  ) as EmbedNonStylesConfig["branding"];
  return brandingColors || {};
};

function getNamespace() {
  if (isValidNamespace(embedStore.namespace)) {
    // Persist this so that even if query params changed, we know that it is an embed.
    return embedStore.namespace;
  }
  if (isBrowser) {
    const namespace = window?.getEmbedNamespace?.() ?? null;
    embedStore.namespace = namespace;
    return namespace;
  }
}

function getEmbedType() {
  if (embedStore.embedType) {
    return embedStore.embedType;
  }
  if (isBrowser) {
    const url = new URL(document.URL);
    const embedType = (embedStore.embedType =
      url.searchParams.get("embedType"));
    return embedType;
  }
}

export const useIsEmbed = (embedSsr?: boolean) => {
  const [isEmbed, setIsEmbed] = useState(embedSsr);
  useEffect(() => {
    const namespace = getNamespace();
    const _isValidNamespace = isValidNamespace(namespace);
    if (parent !== window && !_isValidNamespace) {
      log(
        "Looks like you have iframed cal.com but not using Embed Snippet. Directly using an iframe isn't recommended."
      );
    }
    setIsEmbed(window?.isEmbed?.() || false);
  }, []);
  return isEmbed;
};

export const useEmbedType = () => {
  const [state, setState] = useState<string | null | undefined>(null);
  useEffect(() => {
    setState(getEmbedType());
  }, []);
  return state;
};

export function getEmbedBookerState({
  bookerState,
  slotsQuery,
}: {
  bookerState: BookerState;
  slotsQuery: SlotsQuery;
}): EmbedBookerState {
  if (bookerState === "loading") {
    return "initializing";
  }

  if (slotsQuery.isLoading) {
    return "slotsLoading";
  }

  // Pending but not loading, it means that request is intentionally disabled via enabled:false in useQuery
  if (slotsQuery.isPending) {
    return "slotsDone";
  }

  if (slotsQuery.isSuccess) {
    return "slotsDone";
  }

  if (slotsQuery.isError) {
    return "slotsLoadingError";
  }

  return "slotsPending";
}

/**
 * It is meant to sync BookerState to EmbedBookerState
 * This function is meant to be called outside useEffect so that we don't wait for React to re-render before doing our work
 */
export function updateEmbedBookerState({
  bookerState,
  slotsQuery,
}: {
  bookerState: BookerState;
  slotsQuery: SlotsQuery;
}) {
  // Ensure that only after the bookerState is reflected, we update the embedIsBookerReady
  if (typeof window === "undefined") {
    return;
  }

  const _window = window as Window & {
    _embedBookerState?: EmbedBookerState;
  };

  const embedBookerState = getEmbedBookerState({ bookerState, slotsQuery });
  _window._embedBookerState = embedBookerState;
}
