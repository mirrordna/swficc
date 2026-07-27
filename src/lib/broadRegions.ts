// SWFI broad-region -> country membership (July 16 minutes, item O).
//
// CANONICAL SOURCE: swfi2-final-backend
// src/swfi2_final/domain/region_crosswalk.py — this file is a display-side
// mirror used only for the client-side search Geography filter (options and
// row matching over already-loaded rows). If the backend lists change, this
// mirror must change in the same release. Country strings use SWFI's
// canonical English names as stored on entity records.

const MENA = [
  "Algeria", "Bahrain", "Djibouti", "Egypt", "Iran", "Iraq", "Israel",
  "Jordan", "Kuwait", "Lebanon", "Libya", "Mauritania", "Morocco", "Oman",
  "Palestine", "Qatar", "Saudi Arabia", "Sudan", "Syria", "Tunisia",
  "United Arab Emirates", "Yemen",
];

const CALA = [
  "Antigua and Barbuda", "Argentina", "Bahamas", "Barbados", "Belize",
  "Bolivia", "Brazil", "Chile", "Colombia", "Costa Rica", "Cuba", "Dominica",
  "Dominican Republic", "Ecuador", "El Salvador", "Grenada", "Guatemala",
  "Guyana", "Haiti", "Honduras", "Jamaica", "Mexico", "Nicaragua", "Panama",
  "Paraguay", "Peru", "Saint Kitts and Nevis", "Saint Lucia",
  "Saint Vincent and the Grenadines", "Suriname", "Trinidad and Tobago",
  "Uruguay", "Venezuela",
];

const SOUTHEAST_ASIA = [
  "Brunei", "Cambodia", "Indonesia", "Laos", "Malaysia", "Myanmar",
  "Philippines", "Singapore", "Thailand", "Timor-Leste", "Vietnam",
];

export const SWFI_BROAD_REGIONS: Record<string, readonly string[]> = {
  MENA,
  CALA,
  "Southeast Asia": SOUTHEAST_ASIA,
};

const MEMBERSHIP: Map<string, string[]> = (() => {
  const byCountry = new Map<string, string[]>();
  for (const [regionName, countries] of Object.entries(SWFI_BROAD_REGIONS)) {
    for (const countryName of countries) {
      const key = countryName.toLowerCase();
      byCountry.set(key, [...(byCountry.get(key) ?? []), regionName]);
    }
  }
  return byCountry;
})();

const REGION_LABELS = new Map<string, string>(
  Object.keys(SWFI_BROAD_REGIONS).map((name) => [name.toLowerCase(), name]),
);

// Broad-region names a row belongs to, given its geography-ish values
// (countries, regions, locations). A value that IS a broad-region label
// (a record tagged "MENA" directly) also counts.
export function broadRegionsForValues(values: unknown[]): string[] {
  const found = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const clean = value.trim().toLowerCase();
    if (!clean) continue;
    const direct = REGION_LABELS.get(clean);
    if (direct) found.add(direct);
    for (const regionName of MEMBERSHIP.get(clean) ?? []) found.add(regionName);
  }
  return [...found];
}
