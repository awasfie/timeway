import type React from "react";
import { AppProviders, getAppProviderProps } from "../../AppProvidersServer";

export default async function SessionWarmupLayout({ children }: { children: React.ReactNode }) {
  return <AppProviders {...(await getAppProviderProps())}>{children}</AppProviders>;
}
