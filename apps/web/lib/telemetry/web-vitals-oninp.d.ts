// tsconfig uses moduleResolution "node", which ignores package "exports"; webpack resolves this subpath.
declare module "web-vitals/onINP.js" {
  export { onINP } from "web-vitals";
}
