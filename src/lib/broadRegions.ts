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

// Native SWFI region values as they appear on entity records and in the
// dashboard's Geography dropdowns. These lists are matching aids for
// client-side filtering ONLY (KP feedback 2026-07-27: Geography="Middle
// East" + Entity type="Sovereign Wealth Fund" filtered 50 loaded rows to
// zero because search rows carry `country` but often no `region`). A
// country appearing under two groups simply matches both filters; nothing
// here rewrites source data.
export const SWFI_NATIVE_REGIONS: Record<string, readonly string[]> = {
  "Middle East": [
    "Bahrain", "Iran", "Iraq", "Israel", "Jordan", "Kuwait", "Lebanon",
    "Oman", "Palestine", "Qatar", "Saudi Arabia", "Syria", "Turkey",
    "United Arab Emirates", "Yemen",
  ],
  Europe: [
    "Austria", "Belgium", "Cyprus", "Czech Republic", "Denmark", "Finland",
    "France", "Germany", "Greece", "Hungary", "Iceland", "Ireland", "Italy",
    "Latvia", "Liechtenstein", "Lithuania", "Luxembourg", "Malta", "Monaco",
    "Netherlands", "Norway", "Poland", "Portugal", "Romania", "Spain",
    "Sweden", "Switzerland", "United Kingdom",
  ],
  Asia: [
    "Bangladesh", "Brunei", "Cambodia", "China", "Hong Kong", "India",
    "Indonesia", "Japan", "Kazakhstan", "Laos", "Malaysia", "Mongolia",
    "Myanmar", "Nepal", "Pakistan", "Philippines", "Singapore",
    "South Korea", "Sri Lanka", "Taiwan", "Thailand", "Timor-Leste",
    "Uzbekistan", "Vietnam",
  ],
  "North America": ["Canada", "Mexico", "United States"],
  "Latin America": [
    "Argentina", "Bolivia", "Brazil", "Chile", "Colombia", "Costa Rica",
    "Cuba", "Dominican Republic", "Ecuador", "El Salvador", "Guatemala",
    "Guyana", "Honduras", "Jamaica", "Mexico", "Nicaragua", "Panama",
    "Paraguay", "Peru", "Suriname", "Trinidad and Tobago", "Uruguay",
    "Venezuela",
  ],
  Africa: [
    "Algeria", "Angola", "Botswana", "Cameroon", "Djibouti", "Egypt",
    "Ethiopia", "Gabon", "Ghana", "Kenya", "Libya", "Mauritania",
    "Mauritius", "Morocco", "Mozambique", "Namibia", "Nigeria", "Rwanda",
    "Senegal", "South Africa", "Sudan", "Tanzania", "Tunisia", "Uganda",
    "Zambia", "Zimbabwe",
  ],
  "Australia and Pacific": ["Australia", "Fiji", "New Zealand", "Papua New Guinea"],
};

const MEMBERSHIP: Map<string, string[]> = (() => {
  const byCountry = new Map<string, string[]>();
  for (const groups of [SWFI_BROAD_REGIONS, SWFI_NATIVE_REGIONS]) {
    for (const [regionName, countries] of Object.entries(groups)) {
      for (const countryName of countries) {
        const key = countryName.toLowerCase();
        const existing = byCountry.get(key) ?? [];
        if (!existing.includes(regionName)) byCountry.set(key, [...existing, regionName]);
      }
    }
  }
  return byCountry;
})();

const REGION_LABELS = new Map<string, string>(
  [...Object.keys(SWFI_BROAD_REGIONS), ...Object.keys(SWFI_NATIVE_REGIONS)].map((name) => [name.toLowerCase(), name]),
);

// Countries a native/broad region group resolves to, or null when the value
// is not a known group label. Used by the smart-search intent layer.
export function countriesForRegionGroup(value: string): readonly string[] | null {
  const label = REGION_LABELS.get(String(value || "").trim().toLowerCase());
  if (!label) return null;
  return SWFI_BROAD_REGIONS[label] ?? SWFI_NATIVE_REGIONS[label] ?? null;
}

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
