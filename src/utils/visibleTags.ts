const INTERNAL_ONLY_TAGS = new Set(['smart_calendar', 'plan_ahead', 'week_plan']);

export const getVisibleTags = (tags?: string[] | null, limit?: number): string[] => {
  const unique = new Set<string>();
  const result: string[] = [];

  for (const rawTag of tags ?? []) {
    const tag = rawTag?.trim();
    if (!tag) continue;

    const normalized = tag.toLowerCase();
    if (INTERNAL_ONLY_TAGS.has(normalized)) continue;
    if (unique.has(normalized)) continue;

    unique.add(normalized);
    result.push(tag);

    if (typeof limit === 'number' && result.length >= limit) break;
  }

  return result;
};
