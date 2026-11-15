import surfaces from "../surfaces.json" with { type: "json" };

type RawSurface = (typeof surfaces.surfaces)[number];
export type Surface = RawSurface & { url: string };

// DESIGN_QA_TARGET=ci points at the seeded PR build (ci_path); anything else is the deployed site (path).
const onCi = process.env.DESIGN_QA_TARGET === "ci";
export const SURFACES: Surface[] = surfaces.surfaces.map((s) => ({ ...s, url: onCi ? s.ci_path : s.path }));

// UX.13.7 / UX.13.10-5 render set: 1440 and 390, EN and AR.
export const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const;
export const LOCALES = ["en", "ar"] as const;
