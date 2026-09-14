import type { AppMeta } from "@calcom/types/App";

export const metadata = {
  name: "Camv",
  description:
    "Camv is a self-hosted, LiveKit-powered video meeting room. Automatically generates a secure room link for every booking — no external account needed.",
  installed: true,
  type: "livekit_video",
  variant: "conferencing",
  categories: ["conferencing"],
  logo: "icon.svg",
  publisher: "AWstreams",
  url: "https://camv.co/",
  slug: "camv",
  title: "Camv",
  isGlobal: false,
  email: "help@awstreams.com",
  appData: {
    location: {
      linkType: "dynamic",
      type: "integrations:camv",
      label: "Camv Video",
    },
  },
  dirName: "livekitvideo",
  concurrentMeetings: true,
  isOAuth: false,
} as AppMeta;

export default metadata;
