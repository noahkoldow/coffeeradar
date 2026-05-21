import { Business, Habit, UserPrefs, LocationState, Suggestion, UserBusinessProfile } from '../types';
import { haversineKm } from './travel';
import { addDebugMessage } from './debug';

/**
 * Business Service
 *
 * Handles:
 * 1. Business listing validation (are provided details complete & proper?)
 * 2. Business matching (which businesses align with user's habits?)
 * 3. Business ad placement (convert business to suggestion for deck)
 * 4. Analytics tracking (impressions, clicks, conversions)
 */

/**
 * Validate business submission data before storing in Firebase.
 * Returns { isValid: boolean; errors: string[] }
 */
export function validateBusinessSubmission(data: Partial<Business>): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Required fields
  if (!data.name?.trim()) errors.push('Business name is required');
  if (!data.type) errors.push('Business type is required');
  if (!data.description?.trim()) errors.push('Description is required (50–500 chars recommended)');

  if (data.description && (data.description.length < 20 || data.description.length > 500)) {
    errors.push('Description must be 20–500 characters');
  }

  // Location
  if (!data.place?.lat || !data.place?.lng) errors.push('Location (lat/lng) is required');
  if (!data.place?.address?.trim()) errors.push('Full address is required');

  // Contact
  if (!data.phone?.trim() && !data.website?.trim()) {
    errors.push('At least phone or website is required');
  }

  // Targeting
  if (!data.targetTags || data.targetTags.length === 0) {
    errors.push('At least one target tag is required (e.g., "fitness", "coffee")');
  }

  if (data.targetTags && data.targetTags.length > 8) {
    errors.push('Maximum 8 target tags allowed');
  }

  // Budget (if provided)
  if (data.monthlyBudget && data.monthlyBudget < 10) {
    errors.push('Monthly budget must be at least $10');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Score how well a business aligns with a user's active habits.
 *
 * Score factors:
 * - Tag overlap (business targetTags vs. habit tags)
 * - Time-of-day match (e.g., gym = morning/evening habits)
 * - Habit strength (active streaks > dormant habits)
 * - Recency (active habits weighted higher)
 *
 * Returns 0–1 alignment score.
 */
export function calculateBusinessHabitAlignment(
  business: Business,
  activeHabits: Habit[],
  now = new Date()
): number {
  if (activeHabits.length === 0) {
    // No habits: baseline low score
    return 0.3;
  }

  let totalScore = 0;

  for (const habit of activeHabits) {
    let habitScore = 0;

    // Tag overlap (primary factor)
    const habitTags = new Set(habit.tags ?? []);
    const matchingTags = business.targetTags.filter((t) => habitTags.has(t)).length;
    const tagScore = Math.min(1.0, matchingTags / Math.max(1, business.targetTags.length));
    habitScore += tagScore * 0.6;

    // Time-of-day match (e.g., morning gym habit should see morning gym ads)
    if (habit.timeOfDay === 'morning' && business.targetTags.includes('fitness')) habitScore += 0.2;
    if (habit.timeOfDay === 'afternoon' && (business.targetTags.includes('coffee') || business.targetTags.includes('food'))) habitScore += 0.15;
    if (habit.timeOfDay === 'evening' && business.targetTags.includes('restaurant')) habitScore += 0.15;

    // Habit strength (active streaks)
    const streakBoost = Math.min(0.2, (habit.currentStreak ?? 0) / 30); // 30-day streak = max 0.2 boost
    habitScore += streakBoost;

    totalScore += habitScore;
  }

  return Math.min(1.0, totalScore / Math.max(1, activeHabits.length));
}

/**
 * Get businesses that align with user's active habits and are geographically nearby.
 *
 * Parameters:
 * - businesses: all available businesses
 * - userProfile: user's active habits + location
 * - minAlignmentScore: filter threshold (0–1)
 *
 * Returns: sorted by alignment score (highest first)
 */
export function findAlignedBusinesses(
  businesses: Business[],
  userLocation: LocationState,
  userHabits: Habit[],
  radiusKm: number,
  minAlignmentScore = 0.5,
  limit = 5
): Business[] {
  if (!userLocation.lat || !userLocation.lng) return [];

  const aligned = businesses
    .map((biz) => {
      // Distance filter
      if (biz.place.lat == null || biz.place.lng == null) return null;
      const distKm = haversineKm(userLocation.lat!, userLocation.lng!, biz.place.lat, biz.place.lng);
      if (distKm > radiusKm) return null;

      // Alignment score
      const alignmentScore = calculateBusinessHabitAlignment(biz, userHabits);
      if (alignmentScore < minAlignmentScore) return null;

      return { business: biz, alignmentScore, distKm };
    })
    .filter((item): item is { business: Business; alignmentScore: number; distKm: number } => item != null)
    .sort((a, b) => {
      // Primary: alignment score
      if (b.alignmentScore !== a.alignmentScore) return b.alignmentScore - a.alignmentScore;
      // Secondary: distance (closer is better)
      return a.distKm - b.distKm;
    })
    .slice(0, limit)
    .map((item) => item.business);

  addDebugMessage('business', `Found ${aligned.length}/${businesses.length} aligned businesses`);
  return aligned;
}

/**
 * Convert a business to a suggestion for deck placement.
 *
 * Creates a BusinessSuggestion with:
 * - Confidence reduced from default (0.65–0.75 vs. 0.75+ for organic)
 * - Transparent labeling ("Promoted by...")
 * - Habit matching reason
 */
export function businessToSuggestion(
  business: Business,
  matchingHabit: Habit | undefined,
  alignmentScore: number
): Suggestion {
  const confidenceBase = 0.65;
  const confidenceBoost = alignmentScore * 0.1; // Up to +0.1
  const confidence = Math.min(0.8, confidenceBase + confidenceBoost);

  const reasonShown = matchingHabit
    ? `Matches your "${matchingHabit.name}" habit`
    : 'Recommended for your interests';

  const dayKey = new Date().toISOString().slice(0, 10);

  return {
    id: `biz_${business.id}_${dayKey}`,
    type: 'GO_OUT',
    source: 'business',
    businessId: business.id,
    title: business.name,
    hook: 'Promoted',
    cta: `Visit ${business.name}`,
    description: business.description,
    durationMin: 60, // default for going to a business
    tags: business.targetTags,
    place: business.place,
    rating: business.rating,
    ratingCount: business.ratingCount,
    confidence,
    isRepetitionFriendly: false, // Ads shouldn't repeat too often
    instructions: [
      `Check out this business: ${business.name}`,
      ...(business.phone ? [`Call: ${business.phone}`] : []),
      ...(business.website ? [`Website: ${business.website}`] : []),
    ],
    whyNow: reasonShown,
  };
}

/**
 * Track a business impression (shown to user).
 */
export function recordBusinessImpression(
  userId: string,
  businessId: string,
  profile: UserBusinessProfile | undefined
): UserBusinessProfile {
  const result: UserBusinessProfile = profile ?? {
    userId,
    businessImpressions: {},
    businessInteractions: {},
    habitsActivelyBuilding: {},
    lastUpdated: new Date().toISOString(),
  };

  result.businessImpressions[businessId] = (result.businessImpressions[businessId] ?? 0) + 1;
  result.lastUpdated = new Date().toISOString();

  return result;
}

/**
 * Track a business click (user engaged with ad).
 */
export function recordBusinessClick(
  userId: string,
  businessId: string,
  profile: UserBusinessProfile | undefined
): UserBusinessProfile {
  const result = recordBusinessImpression(userId, businessId, profile);

  result.businessInteractions[businessId] = result.businessInteractions[businessId] ?? { clicked: 0, visited: 0, booked: 0 };
  result.businessInteractions[businessId].clicked++;
  result.lastUpdated = new Date().toISOString();

  return result;
}

/**
 * Track a business conversion (user visited/booked).
 */
export function recordBusinessConversion(
  userId: string,
  businessId: string,
  type: 'visited' | 'booked',
  profile: UserBusinessProfile | undefined
): UserBusinessProfile {
  const result = recordBusinessClick(userId, businessId, profile);

  result.businessInteractions[businessId][type]++;
  result.lastUpdated = new Date().toISOString();

  return result;
}

/**
 * Calculate business ROI for dashboard.
 */
export interface BusinessMetrics {
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number; // click-through rate %
  conversionRate: number; // conversion % of clicks
  estimatedROI: number; // simplified: (conversions * 50) / budget
}

export function calculateBusinessMetrics(
  business: Business,
  monthlyBudget = 100
): BusinessMetrics {
  const impressions = business.metrics?.impressions ?? 0;
  const clicks = business.metrics?.clicks ?? 0;
  const conversions = business.metrics?.conversions ?? 0;

  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
  const conversionRate = clicks > 0 ? (conversions / clicks) * 100 : 0;
  const estimatedROI = monthlyBudget > 0 ? (conversions * 50) / monthlyBudget : 0;

  return {
    impressions,
    clicks,
    conversions,
    ctr: parseFloat(ctr.toFixed(2)),
    conversionRate: parseFloat(conversionRate.toFixed(2)),
    estimatedROI: parseFloat(estimatedROI.toFixed(1)),
  };
}
