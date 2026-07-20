import { Availability } from '../types';

const normalizeTitle = (value?: string | null): string | null => {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
};

const eventMatchesIgnored = (
  event: { title: string; startAt: string; endAt: string; allDay?: boolean },
  ignoredKeys: Set<string>,
): boolean => {
  const titleKey = normalizeTitle(event.title);
  if (!titleKey) return false;
  return ignoredKeys.has(`title:${titleKey}`);
};

export const applyIgnoredEventsToAvailability = (
  availability: Availability,
  ignoredExternalEventKeys: string[],
): Availability => {
  if (!ignoredExternalEventKeys.length) return availability;

  const ignoredSet = new Set(ignoredExternalEventKeys);
  const nextTitleKey = normalizeTitle(availability.nextEventTitle);
  const eventIdKey = availability.currentEventId ? `id:${availability.currentEventId}` : null;
  const titleIgnoreKey = nextTitleKey ? `title:${nextTitleKey}` : null;
  const isCurrentIgnored = (eventIdKey && ignoredSet.has(eventIdKey)) || (titleIgnoreKey && ignoredSet.has(titleIgnoreKey));

  if (!isCurrentIgnored) {
    const filteredContext = (availability.contextEventTitles ?? [])
      .filter((title) => {
        const normalized = normalizeTitle(title);
        if (!normalized) return false;
        if (normalized.startsWith('[all-day]')) {
          const allDayTitle = normalized.replace('[all-day]', '').trim();
          return !ignoredSet.has(`title:${allDayTitle}`);
        }
        return !ignoredSet.has(`title:${normalized}`);
      });

    const filteredDayEvents = (availability.dayEvents ?? []).filter((event) => !eventMatchesIgnored(event, ignoredSet));

    if (
      filteredContext.length === (availability.contextEventTitles ?? []).length
      && filteredDayEvents.length === (availability.dayEvents ?? []).length
    ) {
      return availability;
    }

    return {
      ...availability,
      contextEventTitles: filteredContext,
      dayEvents: filteredDayEvents,
    };
  }

  const now = Date.now();
  const currentEventEnd = availability.currentEventEndAt ? new Date(availability.currentEventEndAt).getTime() : Number.NaN;
  const hasCurrentEnd = Number.isFinite(currentEventEnd);
  const remainingMin = hasCurrentEnd
    ? Math.max(0, Math.round((currentEventEnd - now) / 60000))
    : 0;
  const spanStart = new Date(availability.start).getTime();
  const spanEnd = new Date(availability.end).getTime();
  const hasValidSpan = Number.isFinite(spanStart) && Number.isFinite(spanEnd) && spanEnd > spanStart;
  const fullWindowMin = hasValidSpan
    ? Math.max(0, Math.round((spanEnd - spanStart) / 60000))
    : 0;
  const fallbackDurationMin = Math.max(availability.durationMin, 15);

  return {
    ...availability,
    durationMin: hasCurrentEnd
      ? Math.max(fullWindowMin, remainingMin, fallbackDurationMin, availability.durationMin)
      : Math.max(fullWindowMin, fallbackDurationMin),
    nextEventTitle: null,
    nextEventStartAt: null,
    currentEventId: null,
    currentEventEndAt: null,
    contextEventTitles: (availability.contextEventTitles ?? [])
      .filter((title) => {
        const normalized = normalizeTitle(title);
        if (!normalized) return false;
        if (normalized.startsWith('[all-day]')) {
          const allDayTitle = normalized.replace('[all-day]', '').trim();
          return !ignoredSet.has(`title:${allDayTitle}`);
        }
        return !ignoredSet.has(`title:${normalized}`);
      }),
    dayEvents: (availability.dayEvents ?? []).filter((event) => !eventMatchesIgnored(event, ignoredSet)),
  };
};
