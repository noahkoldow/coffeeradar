import { Availability } from '../types';
import { addMinutes, toISO } from '../utils/time';

export const requestCalendarPermission = async (): Promise<boolean> => {
  return false;
};

export const getCalendarPermissionStatus = async (): Promise<boolean> => {
  return false;
};

export const getCalendars = async (): Promise<{ id: string; title: string }[]> => {
  return [];
};

export const getAvailability = async (): Promise<Availability> => {
  const now = new Date();
  const end = addMinutes(now, 120);
  return {
    start: toISO(now),
    end: toISO(end),
    durationMin: 120,
    nextEventTitle: null,
  };
};

export const createPlanEvent = async (): Promise<string> => {
  throw new Error('Calendar not supported on web');
};

export const updatePlanEventEnd = async (_eventId: string, _newEndDate: Date): Promise<void> => {
  return;
};

export const deletePlanEvent = async (): Promise<void> => {
  return;
};

export const getUpcomingEvents = async (): Promise<{ title: string; startDate: Date; endDate: Date }[]> => {
  return [];
};
