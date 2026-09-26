import type { MapActivityOption, MapCoordinate } from './ActivityMap.types';
import { isMapCoordinate, mapPosition, mapViewport } from './ActivityMap.types';

export type SessionActivityMapProps = {
  activities: readonly MapActivityOption[];
  origin?: MapCoordinate | null;
  onSelect: (id: string) => void;
  onSelectGroup: (ids: string[]) => void;
  accent?: string;
  accentText?: string;
};

export type MapCluster = {
  key: string;
  coordinate: MapCoordinate;
  activities: MapActivityOption[];
};

export const sessionMapViewport = (origin: MapCoordinate | null | undefined, activities: readonly MapActivityOption[], aspect = 1.8) => {
  const reference = origin && isMapCoordinate(origin) ? origin : activities.find(option => isMapCoordinate(option.coordinate))?.coordinate;
  return mapViewport(reference ?? { latitude: 0, longitude: 0 }, activities, aspect);
};

/** Cluster in screen space so pins separate as the user zooms into the native map. */
export const clusterSessionActivities = (
  activities: readonly MapActivityOption[],
  viewport: ReturnType<typeof mapViewport>,
  width: number,
  height: number,
): MapCluster[] => {
  const clusters: MapCluster[] = [];
  const seen = new Set<string>();
  for (const activity of activities) {
    if (!isMapCoordinate(activity.coordinate) || seen.has(activity.suggestion.id)) continue;
    seen.add(activity.suggestion.id);
    const point = mapPosition(activity.coordinate, viewport);
    const nearby = clusters.find(cluster => {
      const other = mapPosition(cluster.coordinate, viewport);
      return Math.abs(point.x - other.x) * width / 100 < 72 && Math.abs(point.y - other.y) * height / 100 < 62;
    });
    if (nearby) nearby.activities.push(activity);
    else clusters.push({ key: activity.suggestion.id, coordinate: activity.coordinate, activities: [activity] });
  }
  return clusters;
};
