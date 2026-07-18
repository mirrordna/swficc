export type SmartSearchCategory = "entities" | "opportunities" | "transactions";

export type SmartSearchIntentId =
  | "active-investors"
  | "regional-opportunities"
  | "regional-institutions"
  | "institutional-theme-investments";

export type SmartSearchRequest = {
  key: string;
  endpoint: string;
};

export type SmartSearchIntent = {
  id: SmartSearchIntentId;
  category: SmartSearchCategory;
  label: string;
  explanation: string;
  requests: SmartSearchRequest[];
  region?: string;
  regions?: string[];
  entityTypes?: string[];
};

type RegionDefinition = {
  pattern: RegExp;
  label: string;
  sourceValues: string[];
};

type EntityDefinition = {
  pattern: RegExp;
  label: string;
  buyerLabel: string;
  sourceQuery: string;
  sourceTypes: string[];
  buyerTypes: string[];
};

type ThemeDefinition = {
  pattern: RegExp;
  label: string;
  field: "industry" | "sector";
  sourceValue: string;
};

const REGION_DEFINITIONS: readonly RegionDefinition[] = [
  { pattern: /\b(?:middle[\s-]+east(?:ern)?|mena|gcc)\b/i, label: "Middle East", sourceValues: ["Middle East"] },
  { pattern: /\b(?:emea)\b/i, label: "EMEA", sourceValues: ["Europe", "Middle East", "Africa"] },
  { pattern: /\b(?:europe(?:an)?|eu)\b/i, label: "Europe", sourceValues: ["Europe"] },
  { pattern: /\b(?:apac)\b/i, label: "APAC", sourceValues: ["Asia", "Australia and Pacific"] },
  { pattern: /\b(?:asia(?:n)?)\b/i, label: "Asia", sourceValues: ["Asia"] },
  { pattern: /\b(?:africa(?:n)?)\b/i, label: "Africa", sourceValues: ["Africa"] },
  { pattern: /\b(?:north[\s-]+america(?:n)?)\b/i, label: "North America", sourceValues: ["North America"] },
  { pattern: /\b(?:latin[\s-]+america(?:n)?|latam)\b/i, label: "Latin America", sourceValues: ["Latin America"] },
  { pattern: /\b(?:americas)\b/i, label: "the Americas", sourceValues: ["North America", "Latin America"] },
  { pattern: /\b(?:australia(?:n)?(?:\s+and\s+pacific)?|pacific|oceania)\b/i, label: "Australia and Pacific", sourceValues: ["Australia and Pacific"] },
];

const ENTITY_DEFINITIONS: readonly EntityDefinition[] = [
  {
    pattern: /\b(?:sovereign\s+wealth\s+funds?|swfs?|sovereign\s+investors?)\b/,
    label: "Sovereign wealth funds",
    buyerLabel: "Sovereign Wealth Fund",
    sourceQuery: "Sovereign Wealth Fund",
    sourceTypes: ["Sovereign Wealth Fund"],
    buyerTypes: ["Sovereign Wealth Fund"],
  },
  {
    pattern: /\b(?:public\s+|private\s+)?(?:pension\s+funds?|pension\s+plans?|retirement\s+systems?)\b/,
    label: "Pension funds",
    buyerLabel: "pension-fund",
    sourceQuery: "Pension Fund",
    sourceTypes: ["Pension"],
    buyerTypes: ["Public Pension", "Private Pension"],
  },
  {
    pattern: /\b(?:superannuation\s+(?:funds?|schemes?)|super\s+funds?)\b/,
    label: "Superannuation funds",
    buyerLabel: "superannuation-fund",
    sourceQuery: "Superannuation",
    sourceTypes: ["Superannuation"],
    buyerTypes: ["Superannuation"],
  },
  {
    pattern: /\bcentral\s+banks?\b/,
    label: "Central banks",
    buyerLabel: "central-bank",
    sourceQuery: "Central Bank",
    sourceTypes: ["Central Bank"],
    buyerTypes: ["Central Bank"],
  },
  {
    pattern: /\bfamily\s+offices?\b/,
    label: "Family offices",
    buyerLabel: "family-office",
    sourceQuery: "Family Office",
    sourceTypes: ["Family Office"],
    buyerTypes: ["Family Office"],
  },
  {
    pattern: /\bendowments?(?:\s+plans?)?\b/,
    label: "Endowments",
    buyerLabel: "endowment",
    sourceQuery: "Endowment",
    sourceTypes: ["Endowment"],
    buyerTypes: ["Endowment"],
  },
  {
    pattern: /\bfoundations?\b/,
    label: "Foundations",
    buyerLabel: "foundation",
    sourceQuery: "Foundation",
    sourceTypes: ["Foundation"],
    buyerTypes: ["Foundation"],
  },
  {
    pattern: /\b(?:insurance\s+companies|insurers?)\b/,
    label: "Insurance companies",
    buyerLabel: "insurance-company",
    sourceQuery: "Insurance",
    sourceTypes: ["Insurance"],
    buyerTypes: ["Insurance", "Insurance Company"],
  },
  {
    pattern: /\basset\s+managers?\b/,
    label: "Asset managers",
    buyerLabel: "asset-manager",
    sourceQuery: "Asset Manager",
    sourceTypes: ["Asset Manager"],
    buyerTypes: ["Asset Manager"],
  },
  {
    pattern: /\binvestment\s+consultants?\b/,
    label: "Investment consultants",
    buyerLabel: "investment-consultant",
    sourceQuery: "Investment Consultant",
    sourceTypes: ["Investment Consultant"],
    buyerTypes: ["Investment Consultant"],
  },
];

// These values deliberately preserve the serving taxonomy, including its
// misspelling of "Artifical". User-facing labels remain plain language.
const THEME_DEFINITIONS: readonly ThemeDefinition[] = [
  { pattern: /\b(?:ai|artificial\s+intelligence|machine\s+learning|generative\s+ai)\b/, label: "AI", field: "industry", sourceValue: "Artifical Intelligence and Machine Learning" },
  { pattern: /\bcyber(?:security)?\b/, label: "cybersecurity", field: "industry", sourceValue: "Cybersecurity" },
  { pattern: /\b(?:semiconductors?|chips?)\b/, label: "semiconductors", field: "industry", sourceValue: "Semiconductors" },
  { pattern: /\b(?:biotech|biotechnology)\b/, label: "biotechnology", field: "industry", sourceValue: "Biotechnology" },
  { pattern: /\b(?:renewables?|renewable\s+energy)\b/, label: "renewables", field: "industry", sourceValue: "Renewables" },
  { pattern: /\b(?:healthcare|health\s+care|life\s+sciences?)\b/, label: "healthcare", field: "sector", sourceValue: "Healthcare" },
  { pattern: /\b(?:real\s+estate|property)\b/, label: "real estate", field: "sector", sourceValue: "Real Estate" },
  { pattern: /\binfrastructure\b/, label: "infrastructure", field: "sector", sourceValue: "Infrastructure" },
  { pattern: /\b(?:agriculture|agritech)\b/, label: "agriculture", field: "sector", sourceValue: "Agriculture" },
  { pattern: /\bsoftware\b/, label: "software", field: "industry", sourceValue: "Software" },
  { pattern: /\b(?:information\s+technology|technology|tech)\b/, label: "information technology", field: "sector", sourceValue: "Information Technology" },
  { pattern: /\b(?:financials?|financial\s+services)\b/, label: "financials", field: "sector", sourceValue: "Financials" },
  { pattern: /\benergy\b/, label: "energy", field: "sector", sourceValue: "Energy" },
  { pattern: /\bindustrials?\b/, label: "industrials", field: "sector", sourceValue: "Industrials" },
];

export function smartSearchIntentForQuery(query: string): SmartSearchIntent | null {
  const clean = normalizeIntentText(query);
  if (!clean) return null;

  const region = intentRegionDefinition(query);
  const entity = ENTITY_DEFINITIONS.find((definition) => definition.pattern.test(clean));
  const theme = THEME_DEFINITIONS.find((definition) => definition.pattern.test(clean));
  const investmentAction = isInvestmentActionQuery(clean);

  if (isActiveInvestorQuery(clean)) {
    const entityLabel = entity?.label.toLowerCase() || "investors";
    const regionLabel = region ? ` in ${region.label}` : "";
    return {
      id: "active-investors",
      category: "entities",
      region: region?.label,
      regions: region?.sourceValues,
      entityTypes: entity?.sourceTypes,
      label: `Top active ${entityLabel}${regionLabel}`,
      explanation: `${entity ? `${entity.label} ranked` : "Transaction-buyer entities ranked"} by sourced 30-day activity count${regionLabel}`,
      requests: [{
        key: "active-investors",
        endpoint: "/api/allocator-activity/v1?days=30&limit=10&page=1&sort=activity_count&direction=desc",
      }],
    };
  }

  if (region && isOpportunityQuery(clean)) {
    return {
      id: "regional-opportunities",
      category: "opportunities",
      region: region.label,
      regions: region.sourceValues,
      label: `RFPs and manager searches in ${region.label}`,
      explanation: `Current RFP, mandate, and opportunity records with sourced region ${region.label}`,
      requests: [{
        key: "regional-opportunities",
        endpoint: "/api/live-opportunities/v1?limit=100&page=1",
      }],
    };
  }

  // The current transaction contract can prove buyer type + one taxonomy
  // theme + a maximum 365-day window. A simultaneous geography phrase is
  // intentionally not interpreted because it can mean buyer domicile or
  // target geography, which are distinct fields.
  if (entity && theme && investmentAction && !region) {
    const days = intentDays(clean);
    const requests = entity.buyerTypes.map((buyerType, index) => {
      const params = new URLSearchParams({
        field: theme.field,
        value: theme.sourceValue,
        days: String(days),
        limit: "100",
        page: "1",
        buyer_type: buyerType,
      });
      return {
        key: `institutional-theme-investments-${index}`,
        endpoint: `/api/transaction-drilldown/v1?${params.toString()}`,
      };
    });
    return {
      id: "institutional-theme-investments",
      category: "transactions",
      entityTypes: entity.sourceTypes,
      label: `${entity.label} investing in ${theme.label}`,
      explanation: `${theme.label} transactions in the last ${days} days with a sourced ${entity.buyerLabel} buyer`,
      requests,
    };
  }

  if (region && entity && !investmentAction) {
    return {
      id: "regional-institutions",
      category: "entities",
      region: region.label,
      regions: region.sourceValues,
      entityTypes: entity.sourceTypes,
      label: `${entity.label} in ${region.label}`,
      explanation: `${entity.label} with a sourced region in ${region.label}`,
      requests: region.sourceValues.map((sourceRegion, index) => ({
        key: `regional-institutions-${index}`,
        endpoint: `/api/source-data/search/v1?collection=entities&entity_type=${encodeURIComponent(entity.sourceTypes[0])}&region=${encodeURIComponent(sourceRegion)}&limit=100&page=1`,
      })),
    };
  }

  return null;
}

export function filterSmartSearchIntentRows(intent: SmartSearchIntent, sourceRows: Record<string, unknown>[]): Record<string, unknown>[] {
  return sourceRows.flatMap((row) => {
    if (intent.regions?.length) {
      const rowRegion = normalizedField(row.region);
      if (!intent.regions.some((region) => normalizedField(region) === rowRegion)) return [];
    }
    if (intent.entityTypes?.length) {
      const typeMatch = intent.category === "transactions"
        ? transactionHasBuyerType(row, intent.entityTypes)
        : valueMatchesSourceTypes(row.type || row.entity_type, intent.entityTypes);
      if (!typeMatch) return [];
    }
    if (!String(row.source_url || row.swfi_url || row.url || "").trim()) return [];
    if (intent.category !== "transactions" || !intent.entityTypes?.length) return [row];
    const matchedBuyers = transactionBuyersOfTypes(row, intent.entityTypes);
    return [{
      ...row,
      __smartSearchMatchedBuyers: matchedBuyers.map((buyer) => String(buyer.name || "").trim()).filter(Boolean),
      __smartSearchMatchedBuyerTypes: matchedBuyers.map((buyer) => String(buyer.type || buyer.entity_type || buyer.entityType || "").trim()).filter(Boolean),
    }];
  });
}

export function intentRegion(query: string): string | undefined {
  return intentRegionDefinition(query)?.label;
}

function intentRegionDefinition(query: string): RegionDefinition | undefined {
  return REGION_DEFINITIONS.find((definition) => definition.pattern.test(query));
}

function isActiveInvestorQuery(clean: string): boolean {
  return /\b(?:top|most)\s+active\s+(?:institutional\s+)?(?:investors?|allocators?|lps?|asset\s+owners?)\b/.test(clean)
    || /\bactive\s+(?:investors?|allocators?|lps?|asset\s+owners?)\b/.test(clean)
    || /\b(?:top|most)\s+active\s+(?:sovereign|pension|retirement|superannuation|family|endowment|foundation|insurance|asset|investment)\b/.test(clean)
    || /\bactively\s+(?:deploying|allocating|committing)\s+capital\b/.test(clean)
    || /\bmaking\s+new\s+manager\s+commitments\b/.test(clean);
}

function isOpportunityQuery(clean: string): boolean {
  return /\b(?:rfps?|requests?\s+for\s+proposals?|mandates?|opportunities|manager\s+search(?:es)?|investment\s+search(?:es)?|open\s+search(?:es)?|active\s+search(?:es)?)\b/.test(clean);
}

function isInvestmentActionQuery(clean: string): boolean {
  return /\b(?:invest(?:ing|ed|ments?)?|deals?|transactions?|allocat(?:ing|ed)\s+to|deploy(?:ing|ed)\s+(?:capital\s+)?(?:in|into)|exposure\s+to|back(?:ing|ed)|commit(?:ting|ted)\s+to)\b/.test(clean);
}

function intentDays(clean: string): number {
  if (/\b(?:last|past)\s+(?:30\s+days?|month)\b/.test(clean)) return 30;
  if (/\b(?:last|past)\s+(?:90\s+days?|quarter|3\s+months?)\b/.test(clean)) return 90;
  if (/\b(?:last|past)\s+6\s+months?\b/.test(clean)) return 180;
  return 365;
}

function transactionHasBuyerType(row: Record<string, unknown>, entityTypes: string[]): boolean {
  return transactionBuyersOfTypes(row, entityTypes).length > 0;
}

function transactionBuyersOfTypes(row: Record<string, unknown>, entityTypes: string[]): Record<string, unknown>[] {
  const buyers = Array.isArray(row.buyer_entities)
    ? row.buyer_entities
    : Array.isArray(row.buyerEntities)
      ? row.buyerEntities
      : [];
  return buyers.filter((buyer): buyer is Record<string, unknown> => {
    if (!buyer || typeof buyer !== "object") return false;
    const candidate = buyer as Record<string, unknown>;
    return valueMatchesSourceTypes(candidate.type || candidate.entity_type || candidate.entityType, entityTypes);
  });
}

function valueMatchesSourceTypes(value: unknown, entityTypes: string[]): boolean {
  const candidate = normalizedField(value);
  return entityTypes.some((entityType) => candidate.includes(normalizedField(entityType)));
}

function normalizedField(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function normalizeIntentText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[’']/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}
