#!/usr/bin/env node

/**
 * Phase 1 Integration Test - Executable Verification
 * 
 * This script validates that the entire activity repetition system is working correctly.
 * Run with: npx ts-node src/services/__integration_test__.ts
 */

import {
  isEligibleForRepetition,
  filterForHabitRepetition,
  recordActivityShown,
  recordActivityCompleted,
  shouldSuggestHabitConversion,
  markRepetitionFriendly,
} from './activityRepetitionService';
import { Suggestion, HistoryState, DeckSuggestion } from '../types';

// Test utilities
let passed = 0;
let failed = 0;

function test(name: string, condition: boolean, message?: string) {
  if (condition) {
    console.log(`✓ ${name}`);
    passed++;
  } else {
    console.log(`✗ ${name}${message ? ': ' + message : ''}`);
    failed++;
  }
}

function section(title: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'='.repeat(60)}`);
}

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

section('PHASE 1 INTEGRATION TEST SUITE');

const baseDate = new Date('2026-05-18T10:00:00Z');
const day1 = baseDate;
const day2 = new Date(baseDate.getTime() + 1 * 24 * 60 * 60 * 1000);
const day4 = new Date(baseDate.getTime() + 3 * 24 * 60 * 60 * 1000);
const day7 = new Date(baseDate.getTime() + 6 * 24 * 60 * 60 * 1000);

// Test 1: 72-hour eligibility window
section('Test 1: 72-Hour Eligibility Window');

const eligible24h = isEligibleForRepetition('morning-walk', 
  { 'morning-walk': day1.toISOString() }, 
  day2
);
test('Activity hidden at 24 hours', !eligible24h);

const eligible72h = isEligibleForRepetition('morning-walk',
  { 'morning-walk': day1.toISOString() },
  day4
);
test('Activity shown at 72+ hours', eligible72h);

// Test 2: Smart filtering
section('Test 2: Smart Filtering');

let testHistory: HistoryState = {
  lastShownIds: [],
  lastRejectedIds: [],
  lastAcceptedIds: [],
  lastShownDates: { 'morning-walk': day1.toISOString() },
  completedActivityIds: { 'morning-walk': 1 },
};

const mockSuggestions: DeckSuggestion[] = [
  {
    id: 'morning-walk',
    title: 'Morning Walk',
    type: 'AT_HOME',
    source: 'habit',
    tags: [],
    durationMin: 30,
    confidence: 0.9,
    isRepetitionFriendly: true,
    meta: {},
  },
  {
    id: 'random-event',
    title: 'Random Event',
    type: 'EVENT',
    source: 'ticketmaster',
    tags: [],
    durationMin: 120,
    confidence: 0.7,
    isRepetitionFriendly: false,
    meta: {},
  },
];

const filtered24h = filterForHabitRepetition(mockSuggestions, testHistory, day2);
test('Smart filter hides morning-walk at 24h', 
  !filtered24h.find(s => s.id === 'morning-walk'),
  `Got ${filtered24h.length} items`
);

const filtered72h = filterForHabitRepetition(mockSuggestions, testHistory, day4);
test('Smart filter shows morning-walk at 72h',
  !!filtered72h.find(s => s.id === 'morning-walk'),
  `Got ${filtered72h.length} items`
);

// Test 3: Completion tracking
section('Test 3: Completion Tracking');

let history: HistoryState = {
  lastShownIds: [],
  lastRejectedIds: [],
  lastAcceptedIds: [],
  lastShownDates: {},
  completedActivityIds: {},
};

history = recordActivityCompleted('activity-1', history);
test('After 1st completion: count = 1', 
  history.completedActivityIds['activity-1'] === 1);

history = recordActivityCompleted('activity-1', history);
test('After 2nd completion: count = 2',
  history.completedActivityIds['activity-1'] === 2);

history = recordActivityCompleted('activity-1', history);
test('After 3rd completion: count = 3',
  history.completedActivityIds['activity-1'] === 3);

// Test 4: Habit conversion detection
section('Test 4: Habit Conversion Detection');

test('At 1 completion: not ready', 
  !shouldSuggestHabitConversion('activity-1', 1));

test('At 2 completions: not ready',
  !shouldSuggestHabitConversion('activity-1', 2));

test('At 3 completions: READY',
  shouldSuggestHabitConversion('activity-1', 3));

test('At 5 completions: still ready',
  shouldSuggestHabitConversion('activity-1', 5));

// Test 5: Show timestamp tracking
section('Test 5: Show Timestamp Tracking');

let trackingHistory: HistoryState = {
  lastShownIds: [],
  lastRejectedIds: [],
  lastAcceptedIds: [],
  lastShownDates: {},
  completedActivityIds: {},
};

trackingHistory = recordActivityShown('morning-walk', trackingHistory, day1);
test('Timestamp recorded on first show',
  trackingHistory.lastShownDates['morning-walk'] === day1.toISOString());

trackingHistory = recordActivityShown('morning-walk', trackingHistory, day4);
test('Timestamp updated on second show',
  trackingHistory.lastShownDates['morning-walk'] === day4.toISOString());

// Test 6: Repetition-friendly marking
section('Test 6: Repetition-Friendly Marking');

const unmapped: Suggestion = {
  id: 'test',
  title: 'Test',
  type: 'AT_HOME',
  source: 'habit',
  tags: [],
  durationMin: 30,
  confidence: 0.8,
};

const marked = markRepetitionFriendly(unmapped);
test('Activity marked as repetition-friendly',
  marked.isRepetitionFriendly === true);

// Test 7: Complete 7-day scenario
section('Test 7: Complete 7-Day Habit Formation Scenario');

let scenarioHistory: HistoryState = {
  lastShownIds: [],
  lastRejectedIds: [],
  lastAcceptedIds: [],
  lastShownDates: {},
  completedActivityIds: {},
};

// Day 1
scenarioHistory = recordActivityShown('morning-walk', scenarioHistory, day1);
scenarioHistory = recordActivityCompleted('morning-walk', scenarioHistory);
test('Day 1: Activity shown and completed',
  scenarioHistory.completedActivityIds['morning-walk'] === 1 &&
  scenarioHistory.lastShownDates['morning-walk'] === day1.toISOString()
);

// Day 2 (24h) - should be hidden
const day2Eligible = isEligibleForRepetition('morning-walk', scenarioHistory.lastShownDates, day2);
test('Day 2 (24h): Activity hidden',
  !day2Eligible);

// Day 4 (72h) - should show
const day4Eligible = isEligibleForRepetition('morning-walk', scenarioHistory.lastShownDates, day4);
test('Day 4 (72h): Activity eligible',
  day4Eligible);

scenarioHistory = recordActivityShown('morning-walk', scenarioHistory, day4);
scenarioHistory = recordActivityCompleted('morning-walk', scenarioHistory);
test('Day 4: Activity shown and completed again',
  scenarioHistory.completedActivityIds['morning-walk'] === 2);

// Day 7 (72h from day 4)
const day7Eligible = isEligibleForRepetition('morning-walk', scenarioHistory.lastShownDates, day7);
test('Day 7 (72h from day 4): Activity eligible',
  day7Eligible);

scenarioHistory = recordActivityShown('morning-walk', scenarioHistory, day7);
scenarioHistory = recordActivityCompleted('morning-walk', scenarioHistory);
test('Day 7: Activity shown and completed (3rd time)',
  scenarioHistory.completedActivityIds['morning-walk'] === 3);

const isHabitReady = shouldSuggestHabitConversion('morning-walk', 
  scenarioHistory.completedActivityIds['morning-walk'] || 0);
test('Day 7: Habit conversion READY',
  isHabitReady);

// ============================================================================
// RESULTS
// ============================================================================

section(`RESULTS: ${passed} passed, ${failed} failed`);

if (failed === 0) {
  console.log('\n✓✓✓ ALL TESTS PASSED ✓✓✓');
  console.log('\nPhase 1 Activity Repetition System is FULLY OPERATIONAL\n');
  process.exit(0);
} else {
  console.log(`\n✗ ${failed} tests failed\n`);
  process.exit(1);
}
