#!/bin/sh
# WC-TW-5a: fetch the pinned IANA tzdata and ICU zone resources, verify sha256, compile.
#   ops/tzdata/install.sh <out-dir>
# Produces <out-dir>/zoneinfo (zic output + tzdata.zi "# version <pin>" + tab files, replaces /usr/share/zoneinfo)
# and <out-dir>/icu (*.res for ICU_TIMEZONE_FILES_DIR). Needs curl or wget, sha256sum or shasum, tar, zic.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out=${1:?usage: install.sh <out-dir>}
. "$here/pin.env"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

fetch() {
  if command -v curl >/dev/null 2>&1; then curl -fsSL --retry 3 -o "$2" "$1"; else wget -q -O "$2" "$1"; fi
}

icu_base="https://raw.githubusercontent.com/unicode-org/icu-data/$ICU_DATA_COMMIT/tzdata/icunew/$TZ_VERSION/44/le"
fetch "https://data.iana.org/time-zones/releases/tzdata$TZ_VERSION.tar.gz" "$work/tzdata$TZ_VERSION.tar.gz"
for f in metaZones timezoneTypes windowsZones zoneinfo64; do
  fetch "$icu_base/$f.res" "$work/$f.res"
done

# Every line in SHA256SUMS must name a fetched file for this pin; a stale sums file fails here, not at runtime.
cp "$here/SHA256SUMS" "$work/SHA256SUMS"
if command -v sha256sum >/dev/null 2>&1; then (cd "$work" && sha256sum -c --strict SHA256SUMS); else (cd "$work" && shasum -a 256 -c SHA256SUMS); fi

mkdir -p "$work/src"
tar xzf "$work/tzdata$TZ_VERSION.tar.gz" -C "$work/src"
got=$(cat "$work/src/version")
[ "$got" = "$TZ_VERSION" ] || { echo "tzdata tarball version $got != pin $TZ_VERSION" >&2; exit 1; }

# Raw main-format sources go straight to zic (no awk/make), and the same text becomes tzdata.zi under the
# "# version" header Debian and Postgres images use, so one probe reads the version everywhere.
sources="africa antarctica asia australasia europe northamerica southamerica etcetera factory backward"
rm -rf "$out/zoneinfo" "$out/icu"
mkdir -p "$out/zoneinfo" "$out/icu"
(cd "$work/src" && zic -d "$out/zoneinfo" $sources)
{
  echo "# version $TZ_VERSION"
  (cd "$work/src" && cat $sources)
} >"$out/zoneinfo/tzdata.zi"
(cd "$work/src" && cp iso3166.tab zone.tab zone1970.tab zonenow.tab leap-seconds.list "$out/zoneinfo/")
cp "$work"/*.res "$out/icu/"
echo "tzdata $TZ_VERSION installed into $out"
