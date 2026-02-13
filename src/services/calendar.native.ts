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
    const end = addMinutes(now, 120);
    return {
      start: toISO(now),
      end: toISO(end),
      durationMin: 120,
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
    };
  }

  const nextEvent = sorted[0];
  if (!nextEvent) {
    const end = addMinutes(now, 120);
    return {
      start: toISO(now),
      end: toISO(end),
      durationMin: 120,
      nextEventTitle: null,
    };
  }

  const diff = minutesBetween(now, toDate(nextEvent.startDate));
  if (diff > 360) {
    const end = addMinutes(now, 120);
    return {
      start: toISO(now),
      end: toISO(end),
      durationMin: 120,
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

export const deletePlanEvent = async (eventId: string): Promise<void> => {
  await Calendar.deleteEventAsync(eventId);
};
