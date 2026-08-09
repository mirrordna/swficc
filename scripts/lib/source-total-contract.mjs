function integer(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function sourcePacketTotal(packet) {
  const data = packet?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return integer(data.count);
}

export function validateSourceBoundTotal({
  packet,
  renderedTotal,
  minimum = 1,
  maxAgeHours = 24,
  expectedSourceCollection = "",
  requireCompleteCoverage = true,
  now = Date.now(),
}) {
  const failures = [];
  const total = sourcePacketTotal(packet);
  const generatedAt = Date.parse(String(packet?.generated_at || ""));
  const ageHours = Number.isFinite(generatedAt) ? (now - generatedAt) / 36e5 : Infinity;
  const coverage = packet?.data?.coverage;
  const sourceCollection = String(packet?.data?.source_collection || "");

  if (String(packet?.status || "").toLowerCase() !== "ok") failures.push("source_packet_status_not_ok");
  if (packet?.fact !== true) failures.push("source_packet_not_fact");
  if (!Number.isFinite(ageHours) || ageHours < 0 || ageHours > maxAgeHours) failures.push("source_packet_stale_or_invalid");
  if (total === null) failures.push("source_packet_count_missing");
  if (requireCompleteCoverage && !coverage) failures.push("source_packet_coverage_missing");
  if (requireCompleteCoverage && coverage && coverage.complete !== true) failures.push("source_packet_coverage_incomplete");
  if (expectedSourceCollection && sourceCollection !== expectedSourceCollection) {
    failures.push(`source_collection_${sourceCollection || "missing"}_ne_${expectedSourceCollection}`);
  }
  if (total !== null && total < minimum) failures.push(`source_total_too_low:${total}<${minimum}`);
  if (total !== null && renderedTotal !== total) failures.push(`rendered_total_${renderedTotal}_ne_source_${total}`);

  return {
    ok: failures.length === 0,
    failures,
    source_total: total,
    source_generated_at: String(packet?.generated_at || ""),
    source_age_hours: Number.isFinite(ageHours) ? Number(ageHours.toFixed(2)) : null,
    source_collection: sourceCollection,
    source_coverage_complete: coverage ? coverage.complete === true : null,
  };
}
