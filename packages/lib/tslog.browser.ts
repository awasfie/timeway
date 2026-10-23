// Browser build of `tslog` (aliased in apps/web/next.config.ts for the browser condition only).
// tslog's browser runtime (BaseLogger + util.inspect polyfill) cost ~17 KB gz on the booking route
// although the client only needs leveled console output. Server bundles keep the real tslog.
import type { ISettingsParam } from "tslog";

type LogFn = (...args: unknown[]) => undefined;

// tslog levels: 0 silly, 1 trace, 2 debug, 3 info, 4 warn, 5 error, 6 fatal.
const LEVELS = [
  ["silly", "debug"],
  ["trace", "debug"],
  ["debug", "debug"],
  ["info", "info"],
  ["warn", "warn"],
  ["error", "error"],
  ["fatal", "error"],
] as const;

type ConsoleMethod = (typeof LEVELS)[number][1];

export class Logger<LogObj = unknown> {
  settings: ISettingsParam<LogObj> & { minLevel: number };
  silly!: LogFn;
  trace!: LogFn;
  debug!: LogFn;
  info!: LogFn;
  warn!: LogFn;
  error!: LogFn;
  fatal!: LogFn;

  constructor(settings?: ISettingsParam<LogObj>) {
    this.settings = { ...settings, minLevel: settings?.minLevel ?? 0 };
    LEVELS.forEach(([name, method], levelId) => {
      this[name] = (...args: unknown[]) => this.log(levelId, method, args);
    });
  }

  private log(levelId: number, method: ConsoleMethod, args: unknown[]): undefined {
    if (levelId < this.settings.minLevel) return undefined;
    const prefix = [...(this.settings.prefix ?? [])];
    if (this.settings.name) prefix.unshift(`[${this.settings.name}]`);
    console[method](...prefix, ...args);
    return undefined;
  }

  getSubLogger(settings?: ISettingsParam<LogObj>): Logger<LogObj> {
    return new Logger<LogObj>({
      ...this.settings,
      ...settings,
      prefix: [...(this.settings.prefix ?? []), ...(settings?.prefix ?? [])],
    });
  }

  attachTransport(): void {}
}

export type { ISettingsParam };
