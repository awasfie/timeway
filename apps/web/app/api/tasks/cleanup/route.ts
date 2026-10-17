import { defaultResponderForAppDir } from "app/api/defaultResponderForAppDir";

import { withTwPlatformJob } from "@calcom/lib/server/tw-org-scope/unattended";
import { GET as handler } from "@calcom/features/tasker/api/cleanup";

// TW-T9.2b3: tasker queue spans orgs, platform scope "tasks-cleanup".
export const GET = defaultResponderForAppDir(withTwPlatformJob("tasks-cleanup", handler));
