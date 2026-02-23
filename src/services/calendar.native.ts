import * as Calendar from 'expo-calendar';
import { Availability } from '../types';
import { addMinutes, minutesBetween, toISO } from '../utils/time';

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

const getWritableCalendarId = async (): Promise<string | null> => {
  const calendars = await getCalendars();
  if (!calendars.length) return null;
  const modifiable = calendars.find((cal) => cal.allowsModifications);
  if (modifiable) return modifiable.id;
  const primary = calendars.find((cal) => cal.isPrimary);
  return primary ? primary.id : calendars[0].id;
};

export const getAvailability = async (enabledCalendarIds?: string[]): Promise<Availability> => {
  const now = new Date();
  const windowEnd = addMinutes(now, 360);
  const calendars = await getCalendars();
  const calendarIds = enabledCalendarIds && enabledCalendarIds.length
    ? enabledCalendarIds
    : calendars.map((cal) => cal.id);

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
  const sorted = events
    .filter((event) => event.startDate)
    .sort((a, b) => toDate(a.startDate).getTime() - toDate(b.startDate).getTime());

  const ongoing = sorted.find(
    (event) =>
      toDate(event.startDate).getTime() <= now.getTime() &&
      (event.endDate ? toDate(event.endDate).getTime() > now.getTime() : false),
  );

  if (ongoing) {
    return {
      start: toISO(now),
      end: toISO(now),
      durationMin: 0,
      nextEventTitle: ongoing.title ?? null,
      currentEventId: ongoing.id ?? null,
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
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
};

/** Shorten an existing calendar event so it ends at `newEndDate`. */
export const updatePlanEventEnd = async (eventId: string, newEndDate: Date): Promise<void> => {
  await Calendar.updateEventAsync(eventId, {
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
  enabledCalendarIds?: string[],
): Promise<{ title: string; startDate: Date; endDate: Date }[]> => {
  const calendars = await getCalendars();
  const calendarIds = enabledCalendarIds && enabledCalendarIds.length
    ? enabledCalendarIds
    : calendars.map((cal) => cal.id);
  if (!calendarIds.length) return [];
  const events = await Calendar.getEventsAsync(calendarIds, startDate, endDate);
  return events.map((e) => ({
    title: e.title ?? 'Untitled',
    startDate: toDate(e.startDate),
    endDate: e.endDate ? toDate(e.endDate) : toDate(e.startDate),
  }));
};
