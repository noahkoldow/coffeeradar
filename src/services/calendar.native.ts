import * as Calendar from 'expo-calendar';
import { Availability, DayEventInfo } from '../types';
import { addMinutes, getPreferredTimeZone, minutesBetween, toISO } from '../utils/time';

export const requestCalendarPermission = async (): Promise<boolean> => {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  return status === 'granted';
};

export const getCalendarPermissionStatus = async (): Promise<boolean> => {
  const { status } = await Calendar.getCalendarPermissionsAsync();
  return status === 'granted';
};

export const getCalendars = async (): Promise<Calendar.Calendar[]> => {
  return Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
};

const toDate = (value: Date | string): Date => {
  return value instanceof Date ? value : new Date(value);
};

const startOfLocalDay = (date: Date): Date => {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
};

const endOfLocalDay = (date: Date): Date => {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
};

const buildAvailabilityFromEvents = (
  dayStart: Date,
  dayEnd: Date,
  events: Calendar.Event[],
): Availability => {
  // All-day events are treated as reminders/markers and do not block time.
  const timedEvents = events.filter((event) => !event.allDay);
  const allDayEvents = events.filter((event) => !!event.allDay);

  const sorted = timedEvents
    .filter((event) => event.startDate)
    .map((event) => ({
      title: event.title ?? null,
      start: new Date(Math.max(toDate(event.startDate).getTime(), dayStart.getTime())),
      end: new Date(Math.min((event.endDate ? toDate(event.endDate) : toDate(event.startDate)).getTime(), dayEnd.getTime())),
    }))
    .filter((event) => event.end.getTime() > event.start.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  let cursor = dayStart.getTime();
  let bestStart = dayStart;
  let bestEnd = dayEnd;
  let bestNextEventTitle: string | null = sorted[0]?.title ?? null;
  let bestNextEventStart: Date | null = sorted[0]?.start ?? null;
  let bestPreviousEventTitle: string | null = null;
  let bestPreviousEventEnd: Date | null = null;
  let bestGap = -1;
  let lastEvent: { title: string | null; start: Date; end: Date } | null = null;

  for (const event of sorted) {
    const eventStart = event.start.getTime();
    if (eventStart > cursor) {
      const gap = eventStart - cursor;
      if (gap > bestGap) {
        bestGap = gap;
        bestStart = new Date(cursor);
        bestEnd = event.start;
        bestNextEventTitle = event.title;
        bestNextEventStart = event.start;
        bestPreviousEventTitle = lastEvent?.title ?? null;
        bestPreviousEventEnd = lastEvent?.end ?? null;
      }
    }
    cursor = Math.max(cursor, event.end.getTime());
    if (!lastEvent || event.end.getTime() >= lastEvent.end.getTime()) {
      lastEvent = event;
    }
  }

  if (cursor < dayEnd.getTime()) {
    const gap = dayEnd.getTime() - cursor;
    if (gap > bestGap) {
      bestGap = gap;
      bestStart = new Date(cursor);
      bestEnd = dayEnd;
      bestNextEventTitle = null;
      bestNextEventStart = null;
      bestPreviousEventTitle = lastEvent?.title ?? null;
      bestPreviousEventEnd = lastEvent?.end ?? null;
    }
  }

  // Include all-day event titles in context so the AI is aware of them,
  // prefixed so the model knows they don't occupy a specific time slot.
  const allDayTitles = allDayEvents
    .map((e) => e.title)
    .filter((t): t is string => !!t && t.trim().length > 0)
    .map((t) => `[all-day] ${t}`);

  const contextEventTitles = [
    ...allDayTitles,
    ...sorted
      .map((event) => event.title)
      .filter((title): title is string => !!title && title.trim().length > 0),
  ].slice(0, 12);

  const dayEvents: DayEventInfo[] = [
    ...allDayEvents
      .map((event) => (event.title ?? '').trim())
      .filter((title) => title.length > 0)
      .map((title) => ({ title, startAt: toISO(dayStart), endAt: toISO(dayEnd), allDay: true as const })),
    ...sorted
      .filter((event) => !!event.title && event.title.trim().length > 0)
      .map((event) => ({ title: (event.title as string).trim(), startAt: toISO(event.start), endAt: toISO(event.end) })),
  ].slice(0, 16);

  return {
    start: toISO(bestStart),
    end: toISO(bestEnd),
    durationMin: Math.max(0, minutesBetween(bestStart, bestEnd)),
    nextEventTitle: bestNextEventTitle,
    nextEventStartAt: bestNextEventStart ? toISO(bestNextEventStart) : null,
    previousEventTitle: bestPreviousEventTitle,
    previousEventEndAt: bestPreviousEventEnd ? toISO(bestPreviousEventEnd) : null,
    contextEventTitles,
    dayEvents,
  };
};

const getWritableCalendarId = async (): Promise<string | null> => {
  const calendars = await getCalendars();
  if (!calendars.length) return null;
  const modifiable = calendars.find((cal) => cal.allowsModifications);
  if (modifiable) return modifiable.id;
  const primary = calendars.find((cal) => cal.isPrimary);
  return primary ? primary.id : calendars[0].id;
};

export const getAvailability = async (disabledCalendarIds?: string[]): Promise<Availability> => {
  const now = new Date();
  const windowEnd = addMinutes(now, 360);
  const calendars = await getCalendars();
  const calendarIds = calendars
    .map((cal) => cal.id)
    .filter((id) => !(disabledCalendarIds && disabledCalendarIds.includes(id)));

  if (!calendarIds.length) {
    const end = addMinutes(now, 360);
    return {
      start: toISO(now),
      end: toISO(end),
      durationMin: 360,
      nextEventTitle: null,
    };
  }

  const events = await Calendar.getEventsAsync(calendarIds, now, windowEnd);
  // All-day events are reminders/markers and should not block the user's time.
  const sorted = events
    .filter((event) => event.startDate && !event.allDay)
    .sort((a, b) => toDate(a.startDate).getTime() - toDate(b.startDate).getTime());

  const ongoing = sorted.find(
    (event) =>
      toDate(event.startDate).getTime() <= now.getTime() &&
      (event.endDate ? toDate(event.endDate).getTime() > now.getTime() : false),
  );

  if (ongoing) {
    const ongoingEnd = ongoing.endDate ? toDate(ongoing.endDate) : null;
    const nextBlockingEvent = sorted.find((event) => {
      if (event.id === ongoing.id) return false;
      const start = toDate(event.startDate).getTime();
      return start > now.getTime();
    });
    const freeWindowEnd = nextBlockingEvent
      ? toDate(nextBlockingEvent.startDate)
      : windowEnd;
    return {
      start: toISO(now),
      end: toISO(freeWindowEnd),
      durationMin: 0,
      nextEventTitle: ongoing.title ?? null,
      nextEventStartAt: nextBlockingEvent?.startDate ? toISO(toDate(nextBlockingEvent.startDate)) : null,
      currentEventId: ongoing.id ?? null,
      currentEventEndAt: ongoingEnd ? toISO(ongoingEnd) : null,
    };
  }

  const nextEvent = sorted[0];
  if (!nextEvent) {
    return {
      start: toISO(now),
      end: toISO(windowEnd),
      durationMin: 360,
      nextEventTitle: null,
    };
  }

  const diff = minutesBetween(now, toDate(nextEvent.startDate));
  if (diff > 360) {
    return {
      start: toISO(now),
      end: toISO(windowEnd),
      durationMin: 360,
      nextEventTitle: nextEvent.title ?? null,
    };
  }

  return {
    start: toISO(now),
    end: toISO(toDate(nextEvent.startDate)),
    durationMin: Math.max(0, diff),
    nextEventTitle: nextEvent.title ?? null,
  };
};

export const getAvailabilityForDate = async (
  date: Date,
  disabledCalendarIds?: string[],
): Promise<Availability> => {
  const dayStart = startOfLocalDay(date);
  const dayEnd = endOfLocalDay(date);
  const calendars = await getCalendars();
  const calendarIds = calendars
    .map((cal) => cal.id)
    .filter((id) => !(disabledCalendarIds && disabledCalendarIds.includes(id)));

  if (!calendarIds.length) {
    return {
      start: toISO(dayStart),
      end: toISO(dayEnd),
      durationMin: minutesBetween(dayStart, dayEnd),
      nextEventTitle: null,
    };
  }

  const events = await Calendar.getEventsAsync(calendarIds, dayStart, dayEnd);
  return buildAvailabilityFromEvents(dayStart, dayEnd, events);
};

export const createPlanEvent = async (payload: {
  title: string;
  startDate: Date;
  endDate: Date;
  notes?: string;
}): Promise<string> => {
  const calendarId = await getWritableCalendarId();
  if (!calendarId) {
    throw new Error('No writable calendar found');
  }
  return Calendar.createEventAsync(calendarId, {
    title: payload.title,
    startDate: payload.startDate,
    endDate: payload.endDate,
    notes: payload.notes,
    timeZone: getPreferredTimeZone() ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
};

/** Shorten an existing calendar event so it ends at `newEndDate`. */
export const updatePlanEventEnd = async (eventId: string, newEndDate: Date): Promise<void> => {
  await Calendar.updateEventAsync(eventId, {
    endDate: newEndDate,
  });
};

/** Replace an existing calendar event time window with the real activity window. */
export const updatePlanEventTimeRange = async (
  eventId: string,
  newStartDate: Date,
  newEndDate: Date,
): Promise<void> => {
  await Calendar.updateEventAsync(eventId, {
    startDate: newStartDate,
    endDate: newEndDate,
  });
};

export const deletePlanEvent = async (eventId: string): Promise<void> => {
  await Calendar.deleteEventAsync(eventId);
};

/** Return upcoming calendar events in a time window for clash detection */
export const getUpcomingEvents = async (
  startDate: Date,
  endDate: Date,
  disabledCalendarIds?: string[],
): Promise<Array<{ id?: string; title: string; startDate: Date; endDate: Date; allDay?: boolean; location?: string | null }>> => {
  const calendars = await getCalendars();
  const calendarIds = calendars
    .map((cal) => cal.id)
    .filter((id) => !(disabledCalendarIds && disabledCalendarIds.includes(id)));
  if (!calendarIds.length) return [];
  const events = await Calendar.getEventsAsync(calendarIds, startDate, endDate);
  return events.map((e) => {
    const start = toDate(e.startDate);
    let end = e.endDate ? toDate(e.endDate) : toDate(e.startDate);
    const allDay = !!e.allDay;

    // Some providers can return all-day events with equal/invalid end timestamps.
    // Ensure they block at least one full day in local time.
    if (allDay && end.getTime() <= start.getTime()) {
      end = new Date(start);
      end.setDate(end.getDate() + 1);
    }

    return {
      id: e.id,
      title: e.title ?? 'Untitled',
      startDate: start,
      endDate: end,
      allDay,
      location: e.location ?? null,
    };
  });
};
