/* ═══════════════════════════════════════════════
   SWFI Dashboard TypeScript Types
   Matches backend dashboard2 payload schema
   ═══════════════════════════════════════════════ */

export interface SnapshotKPI {
  label: string;
  value: string;
  note: string;
  href: string;
  truth_receipt?: Record<string, unknown> | null;
}

export interface SearchSuggestion {
  label: string;
  query: string;
}

export interface SmartSearch {
  placeholder: string;
  action: string;
  suggestions: SearchSuggestion[];
}

export interface Institution {
  slug: string;
  name: string;
  type: string;
  country: string;
  aum: string;
  strategy: string;
  profile_url: string;
  fit_score: string | number;
  peer_percentile: string | number;
  peer_group: string;
  cagr: string;
  historical_performance: string;
  status: string;
}

export interface InsightItem {
  name?: string;
  title?: string;
  sector?: string;
  label?: string;
  metric?: string;
  aum?: string;
  growth?: string;
  country?: string;
  region?: string;
  status?: string;
  note?: string;
  strategy?: string;
  basis?: string;
  type?: string;
  profile_url?: string;
  href?: string;
}

export interface QuickInsight {
  title: string;
  note: string;
  items: InsightItem[];
  href: string;
}

export interface PerformancePoint {
  label: string;
  assets: number;
  assets_display: string;
  sort_key?: number[];
}

export interface PerformanceEntity {
  slug: string;
  name: string;
  type: string;
  points: PerformancePoint[];
  profile_url: string;
  chart_label: string;
  peer_group: string;
  peer_percentile: number | string;
  benchmark: string;
  growth_display: string;
  cagr_display: string;
  first_label: string;
  latest_label: string;
  latest_assets_display: string;
}

export interface ChartType {
  key: string;
  label: string;
}

export interface HistoricalPerformance {
  title: string;
  entity_types: string[];
  entities: PerformanceEntity[];
  default_entity_slug: string;
  chart_types: ChartType[];
  export_filename: string;
}

export interface PeerMetric {
  key: string;
  label: string;
}

export interface PeerComparison {
  title: string;
  institutions: Institution[];
  metrics: PeerMetric[];
  add_institution_label: string;
}

export interface RankingGroup {
  title: string;
  items: (InsightItem & { rank?: number; metric?: string; basis?: string })[];
  href: string;
}

export interface TrendItem {
  sector: string;
  capital_deployed: string;
  growth: string;
  active_investors: number;
  active_investors_display?: string;
  href: string;
  note?: string;
}

export type BusinessModelItem = TrendItem;

export interface SectorShiftCell {
  label: string;
  value: string;
}

export interface SectorShiftItem {
  sector: string;
  cells: SectorShiftCell[];
  insight: string;
  href: string;
}

export interface RegionalItem {
  region: string;
  capital: string;
  allocation: string;
  note: string;
  href: string;
}

export interface CoInvestmentRow {
  investor_a: string;
  investor_b: string;
  sector: string;
  deal: string;
  amount: string;
  href: string;
}

export interface CoInvestmentKPI {
  label: string;
  value: string;
  href: string;
}

export interface CoInvestmentNetwork {
  title: string;
  nodes: string;
  links: string;
  href: string;
}

export interface CoInvestmentTracking {
  filters: string[];
  kpis: CoInvestmentKPI[];
  rows: CoInvestmentRow[];
  network: CoInvestmentNetwork;
}

export interface InvestorFitRow {
  institution: string;
  sector_focus: string;
  average_ticket_size: string;
  fit: string;
  href: string;
}

export interface TicketSizeBucket {
  label: string;
  href: string;
}

export interface InvestorFitTargeting {
  question: string;
  benefit: string;
  criteria: string[];
  ticket_size_distribution: TicketSizeBucket[];
  rows: InvestorFitRow[];
  href: string;
}

export interface AlertItem {
  label: string;
  status: string;
  href: string;
}

export interface SavedView {
  label: string;
  query: string;
  href: string;
}

export interface Dashboard2Payload {
  schema_version: string;
  generated_at: string;
  snapshot_kpis: SnapshotKPI[];
  smart_search: SmartSearch;
  quick_insights: QuickInsight[];
  historical_performance: HistoricalPerformance;
  peer_comparison: PeerComparison;
  dynamic_rankings: RankingGroup[];
  trend_analytics: TrendItem[];
  funded_business_models: BusinessModelItem[];
  sector_shift_heatmap: SectorShiftItem[];
  regional_allocation: RegionalItem[];
  co_investment_tracking: CoInvestmentTracking;
  investor_fit_targeting: InvestorFitTargeting;
  alerts: AlertItem[];
  saved_views: SavedView[];
}

export interface DashboardPayload {
  dashboard2: Dashboard2Payload;
  live_terminal?: Record<string, unknown>;
  realtime_signals?: Record<string, unknown>;
  realtime_ratings?: {
    top_profiles?: Institution[];
    profiles?: Institution[];
  };
  live_pulse?: {
    items?: InsightItem[];
  };
}
