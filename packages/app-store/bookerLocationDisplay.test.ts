import { describe, expect, it } from "vitest";

import { bookerLocationDisplay, getBookerTranslatedLocation } from "./bookerLocationDisplay";
import {
  AppStoreLocationType,
  defaultLocations,
  getLocationByType,
  getLocationFromApp,
  getTranslatedLocation,
} from "./locations";

const expected = () => {
  const out: Record<string, { label: string; iconUrl: string; defaultValueVariable?: string }> = {};
  const all = [
    ...defaultLocations,
    ...Object.values(AppStoreLocationType).map((type) => getLocationFromApp(type)!),
  ];
  for (const l of all) {
    out[l.type] = {
      label: l.label,
      iconUrl: l.iconUrl,
      ...(l.defaultValueVariable ? { defaultValueVariable: l.defaultValueVariable } : {}),
    };
  }
  return out;
};

describe("bookerLocationDisplay", () => {
  it("matches the full location list (regenerate from the printed diff on failure)", () => {
    expect(bookerLocationDisplay).toEqual(expected());
  });

  it("translates exactly like getTranslatedLocation", () => {
    const t = ((k: string) => `t(${k})`) as never;
    const samples = [
      { type: "inPerson", address: "Riyadh" },
      { type: "inPerson" },
      { type: "link", link: "https://x.test" },
      { type: "phone" },
      { type: "userPhone", hostPhoneNumber: "+966500000000" },
      { type: "attendeeInPerson" },
      { type: "somewhereElse" },
      { type: "conferencing" },
      { type: "integrations:daily" },
      { type: "integrations:zoom" },
      { type: "integrations:google:meet" },
    ];
    for (const loc of samples) {
      expect(getBookerTranslatedLocation(loc, bookerLocationDisplay[loc.type], t)).toEqual(
        getTranslatedLocation(loc as never, getLocationByType(loc.type), t)
      );
    }
  });
});
