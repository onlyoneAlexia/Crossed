export const ACTIVITY_DEFAULT_OPEN = false;

const label = (count: number, singular: string, plural: string) => `${count} ${count === 1 ? singular : plural}`;

export function activitySummary(pendingCount: number, fillCount: number): string {
  const parts = [];
  if (pendingCount > 0) parts.push(label(pendingCount, "pending", "pending"));
  if (fillCount > 0) parts.push(label(fillCount, "fill", "fills"));
  return parts.length > 0 ? parts.join(" · ") : "No swaps";
}

export function activityStatusLabel(summary: string): string {
  return `Open activity status: ${summary}`;
}
