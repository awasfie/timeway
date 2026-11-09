import { defaultResponderForAppDir } from "app/api/defaultResponderForAppDir";

import { withTwPlatformJob } from "@calcom/lib/server/tw-org-scope/unattended";
import { GET as handler } from "@calcom/features/tasker/api/cron";

// TW-T9.2b3: tasker queue spans orgs, platform scope "tasks-cron".
export const GET = defaultResponderForAppDir(withTwPlatformJob("tasks-cron", handler));

/**
 * This runs each minute and we need fresh data each time
 * @see https://nextjs.org/docs/app/building-your-application/caching#opting-out-2
 **/
export const revalidate = 0;
