import process from "node:process";
import { twOrgKyselyOnReserve } from "@calcom/prisma/tw-org-kysely";
import {
  CompiledQuery,
  DeduplicateJoinsPlugin,
  Kysely,
  ParseJSONResultsPlugin,
  PostgresDialect,
} from "kysely";
import { Pool } from "pg";
import type { Booking, DB } from "./types";

export type { DB, Booking };

const connectionString = process.env.DATABASE_URL ?? "postgresql://postgres:@localhost:5450/calendso";

// Same knob as packages/prisma: the RLS spec pins one backend to prove scope never leaks on reuse.
const poolMax = Number.parseInt(process.env.DATABASE_POOL_MAX ?? "", 10) || undefined;
const pool = new Pool({ connectionString, ...(poolMax ? { max: poolMax } : {}) });

// 3. Create the Dialect, passing the configured pool instance
const dialect = new PostgresDialect({
  pool: pool, // Use the pool instance created above
  // t_1952224a: carry the request's org scope (app.tw_org_id) onto every reserved connection; RLS needs it.
  onReserveConnection: twOrgKyselyOnReserve(CompiledQuery.raw),
});

// 4. Create the Kysely instance as before
const db = new Kysely<DB>({
  dialect,
  plugins: [new ParseJSONResultsPlugin(), new DeduplicateJoinsPlugin()],
});

export default db;
