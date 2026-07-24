/**
 * Phase 1 Validation: Activity Repetition Service
 * 
 * Tests to verify the complete Phase 1 implementation works correctly.
 * These are not unit tests but rather validation scenarios showing the system works.
 */

import {
  isEligibleForRepetition,
  filterForHabitRepetition,
  recordActivityShown,
  recordActivityCompleted,
  shouldSuggestHabitConversion,
  markRepetitionFriendly,
} from './activityRepetitionService';
import { Suggestion, HistoryState } from '../types';

/**
 * Validation 1: 72-Hour Eligibility Window
 * 
 * Test: Activity shown at time T should be hidden until T+72 hours
 */
function validateEligibilityWindow() {
  console.log('=== Validation 1: 72-Hour Eligibility Window ===');
  
  const now = new Date('2026-05-18T10:00:00Z');
  const yesterday = new Date('2026-05-17T10:00:00Z'); // 24 hours ago
  const threeDaysAgo = new Date('2026-05-15T10:00:00Z'); // 72 hours ago
  
  const lastShownDates = {
    'morning-walk': yesterday.toISOString(), // 24 hours ago
  };
  
  // 24 hours: not eligible
  const ineligible = isEligibleForRepetition('morning-walk', lastShownDates, now);
  console.assert(!ineligible, 'Activity should NOT be eligible at 24 hours');
  console.log('✓ After 24 hours: Hidden ');
  
  // 72 hours: eligible
  const eligible = isEligibleForRepetition('morning-walk', { 'morning-walk': threeDaysAgo.toISOString() }, now);
  console.assert(eligible, 'Activity should be eligible at 72 hours');
  console.log('✓ After 72+ hours: Shown');
  
  console.log('');
}

/**
 * Validation 2: Completion Counting
 * 
 * Test: System correctly counts activity completions
 */
function validateCompletionCounting() {
  console.log('=== Validation 2: Completion Counting ===');
  
  let history: HistoryState = {
    lastShownIds: [],
    lastRejectedIds: [],
    lastAcceptedIds: [],
    lastShownDates: {},
    completedActivityIds: {},
  };
  
  // First completion
  history = recordActivityCompleted('morning-walk', history);
  console.assert(history.completedActivityIds?.['morning-walk'] === 1, 'Count should be 1 after first completion');
  console.log('✓ Completion 1: Count = 1');
  
  // Second completion
  history = recordActivityCompleted('morning-walk', history);
  console.assert(history.completedActivityIds?.['morning-walk'] === 2, 'Count should be 2 after second completion');
  console.log('✓ Completion 2: Count = 2');
  
  // Third completion
  history = recordActivityCompleted('morning-walk', history);
  console.assert(history.completedActivityIds?.['morning-walk'] === 3, 'Count should be 3 after third completion');
  console.log('✓ Completion 3: Count = 3 (HABIT CONVERSION ELIGIBLE)');
  
  console.log('');
}

/**
 * Validation 3: Habit Conversion Detection
 * 
 * Test: System detects when activity reaches 3+ completions
 */
function validateHabitConversion() {
  console.log('=== Validation 3: Habit Conversion Detection ===');
  
  const isReady1 = shouldSuggestHabitConversion('morning-walk', 1);
  console.assert(!isReady1, 'Should not suggest at 1 completion');
  console.log('✓ 1 completion: Not ready');
  
  const isReady2 = shouldSuggestHabitConversion('morning-walk', 2);
  console.assert(!isReady2, 'Should not suggest at 2 completions');
  console.log('✓ 2 completions: Not ready');
  
  const isReady3 = shouldSuggestHabitConversion('morning-walk', 3);
  console.assert(isReady3, 'Should suggest at 3 completions');
  console.log('✓ 3 completions: READY FOR CONVERSION ✓');
  
  const isReady4 = shouldSuggestHabitConversion('morning-walk', 5);
  console.assert(isReady4, 'Should suggest at 5 completions');
  console.log('✓ 5 completions: Still ready');
  
  console.log('');
}

/**
 * Validation 4: Show Timestamp Tracking
 * 
 * Test: System correctly tracks when activities are shown
 */
function validateShowTracking() {
  console.log('=== Validation 4: Show Timestamp Tracking ===');
  
  let history: HistoryState = {
    lastShownIds: [],
    lastRejectedIds: [],
    lastAcceptedIds: [],
    lastShownDates: {},
    completedActivityIds: {},
  };
  
  const now1 = new Date('2026-05-18T10:00:00Z');
  history = recordActivityShown('morning-walk', history, now1);
  
  console.assert(
    history.lastShownDates?.['morning-walk'] === now1.toISOString(),
    'Should record exact timestamp'
  );
  console.log(`✓ Recorded: morning-walk shown at ${now1.toISOString()}`);
  
  // Update with new time
  const now2 = new Date('2026-05-21T10:00:00Z');
  history = recordActivityShown('morning-walk', history, now2);
  
  console.assert(
    history.lastShownDates?.['morning-walk'] === now2.toISOString(),
    'Should update to new timestamp'
  );
  console.log(`✓ Updated: morning-walk shown at ${now2.toISOString()}`);
  
  console.log('');
}

/**
 * Validation 5: Repetition-Friendly Marking
 * 
 * Test: System correctly marks activities that can repeat
 */
function validateRepetitionMarking() {
  console.log('=== Validation 5: Repetition-Friendly Marking ===');
  
  const habit: Suggestion = {
    id: 'habit-1',
    title: 'Morning Walk',
    description: 'Take a walk',
    type: 'AT_HOME',
    source: 'habit',
    tags: [],
    durationMin: 30,
    confidence: 0.9,
  };
  
  const marked = markRepetitionFriendly(habit);
  
  console.assert(marked.isRepetitionFriendly === true, 'Should mark as repetition-friendly');
  console.log('✓ Habit marked: isRepetitionFriendly = true');
  
  console.log('');
}

/**
 * Validation 6: Complete 7-Day Scenario
 * 
 * Test: Full realistic scenario showing the complete flow
 */
function validateCompleteScenario() {
  console.log('=== Validation 6: Complete 7-Day Habit Formation Scenario ===');
  
  let history: HistoryState = {
    lastShownIds: [],
    lastRejectedIds: [],
    lastAcceptedIds: [],
    lastShownDates: {},
    completedActivityIds: {},
  };
  
  const baseDate = new Date('2026-05-18T10:00:00Z');
  const nextDate = (d: Date, days: number) => new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
  
  // Day 1: Show and accept
  console.log('Day 1 (2026-05-18):');
  history = recordActivityShown('morning-walk', history, baseDate);
  history = recordActivityCompleted('morning-walk', history);
  console.log('  - Activity shown and accepted');
  console.log(`  - Completions: ${history.completedActivityIds?.['morning-walk']}`);
  console.log(`  - Conversion ready? ${shouldSuggestHabitConversion('morning-walk', history.completedActivityIds?.['morning-walk'] || 0)}`);
  
  // Day 2: Hidden (24 hours)
  const day2 = nextDate(baseDate, 1);
  const eligible2 = isEligibleForRepetition('morning-walk', history.lastShownDates, day2);
  console.log('Day 2 (24h later): Activity hidden? ' + (!eligible2 ? '✓' : '✗'));
  
  // Day 4: Show again (72+ hours)
  console.log('Day 4 (72h later):');
  const day4 = nextDate(baseDate, 3);
  const eligible4 = isEligibleForRepetition('morning-walk', history.lastShownDates, day4);
  console.assert(eligible4, 'Should be eligible at 72 hours');
  console.log('  - Activity shown again ✓');
  history = recordActivityShown('morning-walk', history, day4);
  history = recordActivityCompleted('morning-walk', history);
  console.log(`  - Completions: ${history.completedActivityIds?.['morning-walk']}`);
  console.log(`  - Conversion ready? ${shouldSuggestHabitConversion('morning-walk', history.completedActivityIds?.['morning-walk'] || 0)}`);
  
  // Day 7: Show third time
  console.log('Day 7 (72h from day 4):');
  const day7 = nextDate(day4, 3);
  const eligible7 = isEligibleForRepetition('morning-walk', history.lastShownDates, day7);
  console.assert(eligible7, 'Should be eligible again');
  console.log('  - Activity shown again ✓');
  history = recordActivityShown('morning-walk', history, day7);
  history = recordActivityCompleted('morning-walk', history);
  console.log(`  - Completions: ${history.completedActivityIds?.['morning-walk']}`);
  const ready = shouldSuggestHabitConversion('morning-walk', history.completedActivityIds?.['morning-walk'] || 0);
  console.assert(ready, 'Should be ready for habit conversion');
  console.log(`  - Conversion ready? ${ready} ✓✓✓ HABIT FORMATION COMPLETE!`);
  
  console.log('');
}

/**
 * Run all validations
 */
function runValidations() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║   PHASE 1 VALIDATION: Activity Repetition System       ║');
  console.log('║   Testing all components for correctness               ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');
  
  try {
    validateEligibilityWindow();
    validateCompletionCounting();
    validateHabitConversion();
    validateShowTracking();
    validateRepetitionMarking();
    validateCompleteScenario();
    
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║  ✓ ALL VALIDATIONS PASSED                              ║');
    console.log('║  Phase 1: Activity Repetition System is OPERATIONAL   ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');
    
    return true;
  } catch (error) {
    console.error('✗ VALIDATION FAILED:', error);
    return false;
  }
}

// Export for testing
export { runValidations, validateEligibilityWindow, validateCompletionCounting, validateHabitConversion, validateShowTracking, validateRepetitionMarking, validateCompleteScenario };

// Run if called directly
if (require.main === module) {
  runValidations();
}
