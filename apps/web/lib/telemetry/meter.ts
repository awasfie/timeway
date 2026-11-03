import process from "node:process";
import type { Meter } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { MeterProvider, type MetricReader, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";

// Timeway has no Prometheus scrape, so metrics leave as OTLP/http to the Collector and on to Mimir
// (passport#85 pattern). OTEL_EXPORTER_OTLP_ENDPOINT unset: no provider, every instrument is a no-op.
// service.name (Mimir `job`) = OTEL_SERVICE_NAME, default timeway.

export const DEFAULT_EXPORT_INTERVAL_MS = 60_000;

type OtelEnv = Partial<Record<string, string>>;

export function buildMeterProvider(env: OtelEnv, readers?: MetricReader[]): MeterProvider | undefined {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint && !readers) return undefined;
  const interval = Number.parseInt(env.OTEL_METRIC_EXPORT_INTERVAL ?? "", 10);
  return new MeterProvider({
    resource: new Resource({ "service.name": env.OTEL_SERVICE_NAME?.trim() || "timeway" }),
    readers: readers ?? [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${endpoint?.replace(/\/+$/, "")}/v1/metrics` }),
        exportIntervalMillis:
          Number.isFinite(interval) && interval > 0 ? interval : DEFAULT_EXPORT_INTERVAL_MS,
      }),
    ],
  });
}

let provider: MeterProvider | undefined;
let initialised = false;

export function getTimewayMeter(env: OtelEnv = process.env): Meter | undefined {
  if (!initialised) {
    initialised = true;
    provider = buildMeterProvider(env);
    // beforeExit only: a SIGTERM listener would replace Node's default exit and stall container stops.
    if (provider) process.once("beforeExit", () => void provider?.shutdown().catch(() => undefined));
  }
  return provider?.getMeter("timeway");
}
