#!/usr/bin/env python3
"""One-time extract: Ottawa-area FSA rows from the GeoNames free
postal-code dump for migration 0008's home_area seeds.

Operator steps (run once on any machine with python3 + unzip):
  1. curl -sS -o CA.zip https://download.geonames.org/export/zip/CA.zip
  2. unzip -o CA.zip -d geonames-ca            # yields CA.txt (+ readme)
  3. python3 supabase/seeds/ottawa_fsa_from_geonames.py geonames-ca/CA.txt

The dump already carries FSA-level rows (full codes are a separate
download), so FSA rows are used DIRECTLY with their estimated lat/lng
(accuracy 6 = centroid of addresses or shape — exactly our "area
centroid"). The script prints (a) every admin2 area among K-prefixed
rows with row counts, so the Ottawa filter is auditable, and (b) one
ready-to-paste INSERT per selected FSA, plus unclassified K rows for
manual review. Selection: admin2 in Ottawa/Gloucester/Kanata/Nepean
(the amalgamated city) or "ottawa" in admin2/place. Paste everything
back; the selected INSERTs go into the migration verbatim, attributed
to GeoNames (CC BY 4.0).

GeoNames CA.txt columns (tab-separated, no header, 12 fields):
  country, postal, place, admin1 name, admin1 code, admin2 name,
  admin2 code, admin3 name, admin3 code, latitude, longitude, accuracy
"""

import re
import sys
from collections import defaultdict

FUSED_LATLNG = re.compile(r"^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$")
SHORT_NAME = re.compile(r"\(([^)]+)\)\s*$")


def parse_lat_lng(lat_raw: str, lng_raw: str):
    """Parse a lat/lng pair, recovering fused fields like 45.66-77.58."""
    try:
        return float(lat_raw), float(lng_raw)
    except ValueError:
        pass
    for raw in (lat_raw, lng_raw):
        match = FUSED_LATLNG.match(raw.strip())
        if match:
            return float(match.group(1)), float(match.group(2))
    raise ValueError(f"unparseable coordinates: {lat_raw!r} {lng_raw!r}")


def short_name(place: str) -> str:
    match = SHORT_NAME.search(place)
    name = match.group(1) if match else place
    return name.strip()[:100]


def main(path: str) -> int:
    k_rows = []  # (postal, place, admin2, lat, lng, accuracy)
    skipped = 0
    total = 0
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            total += 1
            cols = line.rstrip("\n").split("\t")
            if len(cols) != 12:
                skipped += 1
                continue
            postal = cols[1].replace(" ", "").upper()
            if not postal.startswith("K"):
                continue
            try:
                lat, lng = parse_lat_lng(cols[9], cols[10])
            except ValueError:
                skipped += 1
                continue
            if not (-90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0):
                skipped += 1
                continue
            k_rows.append((postal, cols[2], cols[5], lat, lng, cols[11]))

    by_admin2: dict[str, int] = defaultdict(int)
    for _, _, admin2, _, _, _ in k_rows:
        by_admin2[admin2] += 1
    print(f"total rows: {total}")
    print(f"K-prefixed rows: {len(k_rows)} (skipped malformed: {skipped})")
    print("admin2 areas among K rows:")
    for admin2 in sorted(by_admin2):
        print(f"  {admin2!r}: {by_admin2[admin2]} rows")

    # Ottawa + the amalgamated cities (Orleans sits in Gloucester,
    # Barrhaven in Nepean, Kanata is Kanata); place-name fallback catches
    # Ottawa rows filed under any other area.
    OTTAWA_AREAS = {"ottawa", "gloucester", "kanata", "nepean"}
    # Unclassified FSAs manually reviewed as Ottawa communities (Orleans,
    # Stittsville, Cumberland, Manotick, Greely). All other unclassified
    # K rows are outside the city (Almonte, Prescott-Russell, Glengarry,
    # Grenville, Quinte, Kawarthas, Rockland, Russell, Hawkesbury,
    # Brockville, Smiths Falls, Perth, Arnprior, Renfrew, Petawawa,
    # Trenton, Cobourg, Lindsay) and stay out.
    REVIEWED_INCLUDE = {"K1E", "K2S", "K4A", "K4B", "K4C", "K4M", "K4P"}
    selected = [
        row
        for row in k_rows
        if row[2].lower() in OTTAWA_AREAS
        or "ottawa" in row[2].lower()
        or "ottawa" in row[1].lower()
        or row[0][:3] in REVIEWED_INCLUDE
    ]
    unclassified = [row for row in k_rows if row[2].strip() == ""]
    print(f"\nOttawa-area K rows: {len(selected)}")
    print(f"Unclassified (empty admin2) K rows for review: {len(unclassified)}")
    for postal, place, _, lat, lng, _ in sorted(unclassified):
        print(f"  REVIEW {postal[:3]}|{lat:.5f}|{lng:.5f}|{place[:80]}")
    if not selected:
        print("NO rows selected — paste section (a) so the filter can be fixed.")
        return 2
    print("-- home_area seeds: Ottawa-area K FSAs, GeoNames CC BY 4.0 --")
    for postal, place, admin2, lat, lng, _ in sorted(selected):
        name = short_name(place).replace("'", "''")
        note = admin2 if admin2.strip() else "reviewed Ottawa (unclassified)"
        print(
            f"insert into public.home_area (fsa, lat, lng, name) "
            f"values ('{postal[:3]}', {lat:.5f}, {lng:.5f}, '{name}'); "
            f"-- {note}"
        )
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"usage: {sys.argv[0]} path/to/CA.txt", file=sys.stderr)
        raise SystemExit(2)
    raise SystemExit(main(sys.argv[1]))
