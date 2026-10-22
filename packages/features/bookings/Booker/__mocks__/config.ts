import { vi } from "vitest";

vi.mock("../config", () => ({
  useBookerResizeAnimation: () => ({ current: document.createElement("div") }),
  getBookerSizeClassNames: () => [],
  fadeInLeftClassName: "",
  fadeInUpClassName: "",
}));
