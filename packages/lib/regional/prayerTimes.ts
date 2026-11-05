// Dependency-free solar computation (NOAA/praytimes.org formulation). Angles in degrees.
export type PrayerMethodId = "egyptian" | "ummAlQura" | "dubai" | "muslimWorldLeague" | "karachi";
export type Madhab = "standard" | "hanafi";
export type PrayerName = "fajr" | "sunrise" | "dhuhr" | "asr" | "maghrib" | "isha";

export type PrayerMethod = {
  fajrAngle: number;
  ishaAngle?: number;
  ishaIntervalMinutes?: number;
  maghribOffsetMinutes: number;
  dhuhrOffsetMinutes: number;
};

export const PRAYER_METHODS: Record<PrayerMethodId, PrayerMethod> = {
  egyptian: { fajrAngle: 19.5, ishaAngle: 17.5, maghribOffsetMinutes: 0, dhuhrOffsetMinutes: 1 },
  ummAlQura: { fajrAngle: 18.5, ishaIntervalMinutes: 90, maghribOffsetMinutes: 0, dhuhrOffsetMinutes: 0 },
  dubai: { fajrAngle: 18.2, ishaAngle: 18.2, maghribOffsetMinutes: 3, dhuhrOffsetMinutes: 0 },
  muslimWorldLeague: { fajrAngle: 18, ishaAngle: 17, maghribOffsetMinutes: 0, dhuhrOffsetMinutes: 0 },
  karachi: { fajrAngle: 18, ishaAngle: 18, maghribOffsetMinutes: 0, dhuhrOffsetMinutes: 0 },
};

export type Coordinates = { latitude: number; longitude: number };
export type PrayerOffsets = Partial<Record<PrayerName, number>>;
export type PrayerTimes = Record<PrayerName, Date>;

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

function julianDay(y: number, m: number, d: number): number {
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + b - 1524.5;
}

function sunPosition(jd: number): { declination: number; equation: number } {
  const D = jd - 2451545.0;
  const g = (357.529 + 0.98560028 * D) % 360;
  const q = (280.459 + 0.98564736 * D) % 360;
  const L = (q + 1.915 * Math.sin(rad(g)) + 0.02 * Math.sin(rad(2 * g))) % 360;
  const e = 23.439 - 0.00000036 * D;
  const ra = deg(Math.atan2(Math.cos(rad(e)) * Math.sin(rad(L)), Math.cos(rad(L)))) / 15;
  const eqt = q / 15 - (((ra % 24) + 24) % 24);
  const eqtNorm = eqt > 12 ? eqt - 24 : eqt < -12 ? eqt + 24 : eqt;
  return { declination: deg(Math.asin(Math.sin(rad(e)) * Math.sin(rad(L)))), equation: eqtNorm };
}

// Hours from solar noon until the sun reaches `angle` below the horizon (negative angle = above).
function hourAngle(angle: number, lat: number, decl: number): number {
  const v =
    (-Math.sin(rad(angle)) - Math.sin(rad(lat)) * Math.sin(rad(decl))) /
    (Math.cos(rad(lat)) * Math.cos(rad(decl)));
  if (v > 1 || v < -1) return Number.NaN;
  return deg(Math.acos(v)) / 15;
}

/** Computes prayer instants for a civil date (y, m 1-12, d) at coordinates. Returns UTC Dates. */
export function computePrayerTimes(args: {
  date: { year: number; month: number; day: number };
  coordinates: Coordinates;
  method: PrayerMethodId;
  madhab?: Madhab;
  offsets?: PrayerOffsets;
}): PrayerTimes {
  const { date, coordinates, method, madhab = "standard", offsets = {} } = args;
  const m = PRAYER_METHODS[method];
  const { latitude: lat, longitude: lng } = coordinates;
  // Evaluate the sun at local noon-ish (UTC noon shifted by longitude) for the civil date.
  const jd = julianDay(date.year, date.month, date.day) - lng / (15 * 24);
  const { declination, equation } = sunPosition(jd + 0.5);
  const noon = 12 - equation - lng / 15; // UTC hours
  const dayStartUtc = Date.UTC(date.year, date.month - 1, date.day);
  const at = (hoursUtc: number, name: PrayerName, extraMin = 0): Date => {
    const minutes = hoursUtc * 60 + extraMin + (offsets[name] ?? 0);
    return new Date(dayStartUtc + Math.round(minutes * 60) * 1000);
  };

  const sunriseHA = hourAngle(0.833, lat, declination);
  const fajrHA = hourAngle(m.fajrAngle, lat, declination);
  const asrHA = asrHourAngleFor(madhab === "hanafi" ? 2 : 1, lat, declination);
  const ishaHA = m.ishaAngle !== undefined ? hourAngle(m.ishaAngle, lat, declination) : Number.NaN;
  if ([sunriseHA, fajrHA, asrHA].some(Number.isNaN)) {
    throw new Error(`Prayer times undefined at latitude ${lat} on ${date.year}-${date.month}-${date.day}`);
  }
  const maghribHours = noon + sunriseHA;
  const ishaHours = m.ishaIntervalMinutes !== undefined ? maghribHours + m.ishaIntervalMinutes / 60 : noon + ishaHA;
  if (Number.isNaN(ishaHours)) throw new Error(`Isha undefined at latitude ${lat}`);
  return {
    fajr: at(noon - fajrHA, "fajr"),
    sunrise: at(noon - sunriseHA, "sunrise"),
    dhuhr: at(noon, "dhuhr", m.dhuhrOffsetMinutes),
    asr: at(noon + asrHA, "asr"),
    maghrib: at(maghribHours, "maghrib", m.maghribOffsetMinutes),
    isha: at(ishaHours, "isha"),
  };
}

function asrHourAngleFor(factor: number, lat: number, decl: number): number {
  const a = Math.atan(1 / (factor + Math.tan(rad(Math.abs(lat - decl)))));
  const v = (Math.sin(a) - Math.sin(rad(lat)) * Math.sin(rad(decl))) / (Math.cos(rad(lat)) * Math.cos(rad(decl)));
  return v > 1 || v < -1 ? Number.NaN : deg(Math.acos(v)) / 15;
}
