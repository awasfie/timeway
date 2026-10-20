// Ported 1:1 from awasfie/salesos packages/ui/src/states/use-delayed-visible.ts @ 722e786ea5 (WC-DX-14a 3a68820 #236 + 14a2 d720520 #250)
// for WC-DX-14c2b. Timeway token roles (packages/config/theme/tokens.css + brand-timeway.css) replace the @salesos/ui roles.
import * as React from "react";

export interface DelayedVisibleOptions {
  /** Show-delay in ms (checklist item 30: 150-300). */
  delay?: number;
  /** Once shown, stay visible at least this long in ms (item 30: 300-500). */
  minVisible?: number;
}

/**
 * WC-DX-14 step 2: gate a loading indicator so fast loads never flash it and slow loads never flicker.
 * Returns true only after `loading` has been true for `delay` ms, then stays true for at least `minVisible` ms.
 */
export function useDelayedVisible(
  loading: boolean,
  { delay = 200, minVisible = 400 }: DelayedVisibleOptions = {}
): boolean {
  const [visible, setVisible] = React.useState(false);
  const shownAt = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (loading) {
      if (visible) return;
      const t = setTimeout(() => {
        shownAt.current = Date.now();
        setVisible(true);
      }, delay);
      return () => clearTimeout(t);
    }
    if (!visible) return;
    const left = minVisible - (Date.now() - (shownAt.current ?? 0));
    if (left <= 0) {
      setVisible(false);
      return;
    }
    const t = setTimeout(() => setVisible(false), left);
    return () => clearTimeout(t);
  }, [loading, visible, delay, minVisible]);

  return visible;
}
