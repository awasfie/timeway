import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POLL_INTERVAL_MS, POLL_WINDOW_MS } from "./custom-domain-polling";
import CustomDomainView from "./custom-domain-view";

const ORG = "11111111-1111-4111-8111-111111111111";
const state: { row: null | { hostname: string; status: string; lastError: string | null } } = { row: null };
const refreshCalls: unknown[] = [];
let refreshResult: () => typeof state.row = () => state.row;
const setData = vi.fn((_k: unknown, d: { hostname: typeof state.row }) => {
  state.row = d.hostname;
});

vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@calcom/ui/components/toast", () => ({ showToast: vi.fn() }));
vi.mock("@calcom/ui/components/badge", () => ({
  Badge: ({ children, ...p }: { children: React.ReactNode }) => <span {...p}>{children}</span>,
}));
vi.mock("@calcom/ui/components/button", () => ({
  Button: ({
    children,
    loading: _l,
    color: _c,
    ...p
  }: {
    children: React.ReactNode;
    loading?: boolean;
    color?: string;
  }) => <button {...p}>{children}</button>,
}));
vi.mock("@calcom/ui/components/form", () => ({
  TextField: ({ label, ...p }: { label: string }) => <input aria-label={label} {...p} />,
}));

type Opts = { onSuccess?: (d: unknown) => void };
let rerender: () => void = () => {};
vi.mock("@calcom/trpc/react", () => {
  const cd = {
    get: {
      useQuery: () => ({
        isPending: false,
        data: { hostname: state.row, cnameTarget: "customers.timeway.co" },
      }),
    },
    add: {
      useMutation: (o: Opts) => ({
        isPending: false,
        mutate: (i: { hostname: string }) => {
          state.row = { hostname: i.hostname, status: "pending_dns", lastError: null };
          o.onSuccess?.({ hostname: state.row });
          rerender();
        },
      }),
    },
    refresh: {
      useMutation: (o: Opts) => ({
        isPending: false,
        mutate: (i: unknown) => {
          refreshCalls.push(i);
          state.row = refreshResult();
          o.onSuccess?.({ hostname: state.row });
          rerender();
        },
      }),
    },
    remove: {
      useMutation: (o: Opts) => ({
        isPending: false,
        mutate: () => {
          state.row = null;
          o.onSuccess?.({ removed: true });
          rerender();
        },
      }),
    },
  };
  return {
    trpc: {
      useUtils: () => ({ viewer: { organizations: { customDomain: { get: { setData } } } } }),
      viewer: { organizations: { customDomain: cd } },
    },
  };
});

function Harness() {
  const [, bump] = (require("react") as typeof import("react")).useState(0);
  rerender = () => bump((n) => n + 1);
  return <CustomDomainView orgId={ORG} />;
}

describe("CustomDomainView", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.row = null;
    refreshCalls.length = 0;
    refreshResult = () => state.row;
  });
  afterEach(() => vi.useRealTimers());

  it("add -> pending (CNAME instruction, 48 h note) -> active; polling stops once active", () => {
    render(<Harness />);
    fireEvent.change(screen.getByTestId("custom-domain-input"), { target: { value: "book.example.com" } });
    fireEvent.click(screen.getByTestId("custom-domain-add"));
    expect(screen.getByTestId("custom-domain-cname").textContent).toBe(
      "book.example.com CNAME customers.timeway.co"
    );
    expect(screen.getByText("custom_domain_pending_removed_48h")).toBeTruthy();
    expect(screen.getByTestId("custom-domain-status").textContent).toBe("custom_domain_status_pending_dns");

    act(() => void vi.advanceTimersByTime(POLL_INTERVAL_MS));
    expect(refreshCalls).toHaveLength(1);

    refreshResult = () => ({ hostname: "book.example.com", status: "active", lastError: null });
    act(() => void vi.advanceTimersByTime(POLL_INTERVAL_MS));
    expect(screen.getByTestId("custom-domain-status").textContent).toBe("custom_domain_status_active");
    const n = refreshCalls.length;
    act(() => void vi.advanceTimersByTime(POLL_WINDOW_MS));
    expect(refreshCalls).toHaveLength(n);
    expect(screen.queryByTestId("custom-domain-cname")).toBeNull();
  });

  it("stops polling at 10 minutes and shows Check again", () => {
    state.row = { hostname: "book.example.com", status: "pending_dns", lastError: null };
    render(<Harness />);
    act(() => void vi.advanceTimersByTime(POLL_WINDOW_MS + 5 * POLL_INTERVAL_MS));
    expect(refreshCalls.length).toBeLessThanOrEqual(POLL_WINDOW_MS / POLL_INTERVAL_MS);
    expect(refreshCalls.length).toBeGreaterThanOrEqual(POLL_WINDOW_MS / POLL_INTERVAL_MS - 1);
    expect(screen.getByTestId("custom-domain-check-again")).toBeTruthy();
    expect(screen.queryByTestId("custom-domain-polling")).toBeNull();

    const n = refreshCalls.length;
    act(() => void vi.advanceTimersByTime(5 * POLL_INTERVAL_MS));
    expect(refreshCalls).toHaveLength(n);

    fireEvent.click(screen.getByTestId("custom-domain-check-again"));
    expect(refreshCalls).toHaveLength(n + 1);
    act(() => void vi.advanceTimersByTime(POLL_INTERVAL_MS));
    expect(refreshCalls).toHaveLength(n + 2);
  });

  it("failed shows the error text and remove returns to the input", () => {
    state.row = {
      hostname: "book.example.com",
      status: "failed",
      lastError: "cname_mismatch: points to x.example",
    };
    render(<Harness />);
    expect(screen.getByTestId("custom-domain-error").textContent).toContain("cname_mismatch");
    act(() => void vi.advanceTimersByTime(POLL_INTERVAL_MS * 3));
    expect(refreshCalls).toHaveLength(0);
    fireEvent.click(screen.getByTestId("custom-domain-remove"));
    expect(screen.getByTestId("custom-domain-input")).toBeTruthy();
  });
});
