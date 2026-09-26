const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Run the screen's real placement/edit handlers without native UI or calendars.
const sourcePath = path.resolve(__dirname, '../src/screens/SmartCalendarScreen.tsx');
const source = fs.readFileSync(sourcePath, 'utf8');
const tree = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlerNames = [
  'cloneScheduledActivities', 'enterEditMode', 'closeEditSession', 'discardEditModeChanges',
  'scheduleSuggestion', 'saveSuggestionPlacement', 'saveEditModeChanges',
  'updateCalendarActivity', 'removeCalendarActivity', 'rescheduleActivityTime',
  'updateTodoAfterSchedule', 'saveScheduledActivityEdits', 'commitEventDrag', 'handleDragStateChange',
];
const declarations = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && handlerNames.includes(node.name.getText(tree))) {
    declarations.set(node.name.getText(tree), node.initializer.getText(tree));
  }
  ts.forEachChild(node, visit);
}
visit(tree);
for (const name of handlerNames) assert.ok(declarations.has(name), `${name} exists in the screen`);
const compiled = ts.transpileModule(
  handlerNames.map(name => `const ${name} = ${declarations.get(name)}; exports.${name} = ${name};`).join('\n'),
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } },
).outputText;
const plain = value => JSON.parse(JSON.stringify(value));

function fixture() {
  const startAt = new Date(2026, 9, 3, 9);
  const endAt = new Date(2026, 9, 3, 12);
  const gap = { id: 'gap-1', startAt, endAt, durationMin: 180 };
  const suggestion = {
    id: 'suggestion-1', title: 'A walk', reason: 'Fresh air', durationMin: 30,
    category: 'Exercise', source: 'habit', travelBufferMin: 0, score: 1,
  };
  const deck = {
    id: 'deck-1', type: 'AT_HOME', title: suggestion.title, description: 'Take a walk',
    durationMin: 30, tags: ['smart_calendar'],
    startAt: startAt.toISOString(), endAt: new Date(startAt.getTime() + 30 * 60000).toISOString(),
  };
  return { gap, entry: { suggestion, deck } };
}

function screen({ existing = [], editing = false, linkedTodo = null, calendarGranted = true,
  calendarCreate = async () => 'event-created', canSpend = true } = {}) {
  const { gap, entry } = fixture();
  const writes = { spends: 0, calendar: [], deleted: [], added: [], updated: [], removed: [], todos: [], caches: [] };
  const alerts = [];
  const state = {
    userId: 'user-1', scheduledActivities: plain(existing),
    smartTodos: linkedTodo ? [linkedTodo] : [], permissions: { calendarGranted },
  };
  const context = {
    exports: {}, Date, Promise, Set, Map,
    console: { warn() {} },
    state, premiumEnabled: true, hasSwipesRemaining: true, isGerman: false,
    suggestionPlacement: null, editMode: editing, editHasChanges: false, editSaving: false,
    selectedGap: gap, selectedScheduledActivity: null, calendarMinimized: true,
    schedulingActive: false, draggingBlockId: null,
    gapSuggestions: [entry], gapBatchIndexByKey: {},
    gapSuggestionCache: { 'gap-1::0': [entry.suggestion] },
    editSnapshotRef: { current: editing ? plain(existing) : null },
    editSavingRef: { current: false }, pendingViewportFocusRef: { current: null },
    dragActivityRef: { current: null }, suggestionPlacementRef: { current: null },
    dragStartScrollYRef: { current: 0 }, verticalScrollYRef: { current: 0 },
    dragBaseTranslationRef: { current: 0 }, dragStartColumnIndexRef: { current: null },
    dragTargetColumnIndexRef: { current: null }, pxPerMinute: 2,
    State: { ACTIVE: 4, END: 5, CANCELLED: 3, FAILED: 1 },
    Animated: { timing: () => ({ start() {} }) },
    columns: [{ id: '2026-10-03', date: new Date(gap.startAt), blocks: [], gaps: [gap], timelineStartMin: 420, timelineEndMin: 1320 }],
    Platform: { OS: 'web' },
    Alert: { alert(...args) { alerts.push(args); } },
    dragTranslateY: { setValue() {} },
    stopDragAutoScroll() {}, clearTodoSchedulingMode() {}, focusCalendarViewport() {},
    resolveDropTargetDayId() { throw new Error('A canceled drag must not resolve or commit a drop'); },
    resolveAdjacentDayIdByDrag() { throw new Error('A canceled drag must not resolve or commit a drop'); },
    resolveDropStartAt() { throw new Error('A canceled drag must not resolve or commit a drop'); },
    showPremiumInfo() { throw new Error('Unexpected premium prompt'); },
    minuteOfDay: date => date.getHours() * 60 + date.getMinutes(),
    isSameDay: (a, b) => a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(),
    gapCacheKey: value => value.id,
    gapBatchCacheKey: (value, batch) => `${value.id}::${batch}`,
    normalizeSuggestionTitleKey: value => value.trim().toLowerCase(),
    resolveTodoFromSuggestion: () => linkedTodo,
    getTodoAtomizedProgress: () => ({ isAtomized: false }),
    isTodoEligibleForWindow: () => true,
    timeZone: 'Europe/Berlin',
    persistGapCache(cache) { writes.caches.push(plain(cache)); },
    async createPlanEvent(event) { writes.calendar.push(event); return calendarCreate(event); },
    async deletePlanEvent(id) { writes.deleted.push(id); },
    actions: {
      spendSwipe() { writes.spends++; return canSpend; },
      addScheduledActivity(item) { writes.added.push(plain(item)); state.scheduledActivities = [item, ...state.scheduledActivities]; },
      updateScheduledActivity(id, item) {
        writes.updated.push({ id, item: plain(item) });
        state.scheduledActivities = state.scheduledActivities.map(current => current.id === id ? item : current);
      },
      removeScheduledActivity(id) { writes.removed.push(id); state.scheduledActivities = state.scheduledActivities.filter(item => item.id !== id); },
      updateSmartTodo(todo) { writes.todos.push(plain(todo)); },
    },
  };
  for (const field of ['suggestionPlacement', 'selectedGap', 'selectedScheduledActivity', 'calendarMinimized',
    'editHasChanges', 'editMode', 'editSaving', 'draggingBlockId', 'gapSuggestions',
    'suggestionIndex', 'deckExhausted', 'gapSuggestionCache']) {
    context[`set${field[0].toUpperCase()}${field.slice(1)}`] = value => {
      context[field] = typeof value === 'function' ? value(context[field]) : value;
      if (field === 'suggestionPlacement') context.suggestionPlacementRef.current = context[field];
    };
  }
  Object.defineProperty(context, 'calendarActivities', {
    get: () => context.suggestionPlacement
      ? [...state.scheduledActivities, context.suggestionPlacement.activity]
      : state.scheduledActivities,
  });
  vm.runInNewContext(compiled, context);
  return { context, writes, alerts, gap, entry, ...context.exports };
}

function assertNoPersistence(writes) {
  assert.deepEqual(writes, { spends: 0, calendar: [], deleted: [], added: [], updated: [], removed: [], todos: [], caches: [] });
}

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

test('Add to plan opens a focused editable draft without committing or consuming the suggestion', async () => {
  const instance = screen();
  await instance.scheduleSuggestion(instance.gap, instance.entry);
  assertNoPersistence(instance.writes);
  assert.equal(instance.context.editMode, true);
  assert.equal(instance.context.editHasChanges, true);
  assert.equal(instance.context.calendarMinimized, false);
  assert.equal(instance.context.selectedGap, null);
  assert.equal(instance.context.suggestionPlacement.activity.startAt, instance.gap.startAt.toISOString());
  assert.equal(instance.context.suggestionPlacement.activity.durationMin, 30);
  assert.deepEqual(plain(instance.context.pendingViewportFocusRef.current), { dayId: '2026-10-03', minute: 540 });
  assert.equal(instance.context.gapSuggestions.length, 1);
});

test('moving a draft stays local and Save writes the final chosen time once', async () => {
  const instance = screen();
  await instance.scheduleSuggestion(instance.gap, instance.entry);
  const finalStart = new Date(2026, 9, 3, 10, 35);
  await instance.rescheduleActivityTime(instance.context.suggestionPlacement.activity, finalStart);
  assertNoPersistence(instance.writes);
  assert.equal(instance.context.suggestionPlacement.activity.startAt, finalStart.toISOString());
  await instance.saveEditModeChanges();
  assert.equal(instance.writes.spends, 1);
  assert.equal(instance.writes.calendar.length, 1);
  assert.equal(instance.writes.calendar[0].startDate.getTime(), finalStart.getTime());
  assert.equal(instance.writes.calendar[0].endDate.getTime(), finalStart.getTime() + 30 * 60000);
  assert.equal(instance.writes.added.length, 1);
  assert.equal(instance.writes.added[0].startAt, finalStart.toISOString());
  assert.equal(instance.writes.added[0].commitment.startAt, finalStart.toISOString());
  assert.equal(instance.writes.added[0].calendarEventId, 'event-created');
  assert.equal(instance.writes.caches.length, 1);
  assert.equal(instance.context.gapSuggestions.length, 0);
  assert.equal(instance.context.suggestionPlacement, null);
  assert.equal(instance.context.editMode, false);
});

test('Discard removes the draft without spending a swipe or leaving a calendar event', async () => {
  const instance = screen();
  await instance.scheduleSuggestion(instance.gap, instance.entry);
  await instance.rescheduleActivityTime(instance.context.suggestionPlacement.activity, new Date(2026, 9, 3, 11));
  instance.discardEditModeChanges();
  assertNoPersistence(instance.writes);
  assert.equal(instance.context.suggestionPlacement, null);
  assert.equal(instance.context.editMode, false);
  assert.equal(instance.context.gapSuggestions.length, 1);
});

test('Save cannot create duplicate calendar events while the first save is pending', async () => {
  const pending = deferred();
  const instance = screen({ calendarCreate: () => pending.promise });
  await instance.scheduleSuggestion(instance.gap, instance.entry);
  const firstSave = instance.saveEditModeChanges();
  await instance.saveEditModeChanges();
  assert.equal(instance.writes.spends, 1);
  assert.equal(instance.writes.calendar.length, 1);
  assert.equal(instance.writes.added.length, 0);
  pending.resolve('event-created');
  await firstSave;
  assert.equal(instance.writes.added.length, 1);
  assert.equal(instance.context.editSavingRef.current, false);
  assert.equal(instance.context.editMode, false);
});

test('a linked todo is scheduled at the final placement only when Save succeeds', async () => {
  const linkedTodo = { id: 'todo-1', title: 'A walk', done: false };
  const instance = screen({ linkedTodo });
  await instance.scheduleSuggestion(instance.gap, instance.entry);
  const finalStart = new Date(2026, 9, 3, 11, 15);
  await instance.rescheduleActivityTime(instance.context.suggestionPlacement.activity, finalStart);
  assert.equal(instance.writes.todos.length, 0);
  await instance.saveEditModeChanges();
  assert.equal(instance.writes.todos.length, 1);
  assert.equal(instance.writes.todos[0].scheduledAt, finalStart.toISOString());
  assert.equal(instance.writes.todos[0].scheduledEndAt, new Date(finalStart.getTime() + 30 * 60000).toISOString());
  assert.equal(instance.writes.todos[0].linkedScheduledActivityId, instance.writes.added[0].id);
});

test('Save retains the selected time when calendar permission is unavailable', async () => {
  const instance = screen({ calendarGranted: false });
  await instance.scheduleSuggestion(instance.gap, instance.entry);
  const finalStart = new Date(2026, 9, 3, 10, 20);
  await instance.rescheduleActivityTime(instance.context.suggestionPlacement.activity, finalStart);
  await instance.saveEditModeChanges();
  assert.equal(instance.writes.calendar.length, 0);
  assert.equal(instance.writes.added.length, 1);
  assert.equal(instance.writes.added[0].startAt, finalStart.toISOString());
  assert.equal(instance.writes.added[0].calendarWriteFailed, true);
  assert.equal(instance.writes.added[0].commitment.calendarWriteFailed, true);
  assert.equal(instance.context.editMode, false);
});

test('calendar write failure still saves the final placement in the app and reports sync failure', async () => {
  const instance = screen({ calendarCreate: async () => { throw new Error('Calendar unavailable'); } });
  await instance.scheduleSuggestion(instance.gap, instance.entry);
  await instance.saveEditModeChanges();
  assert.equal(instance.writes.spends, 1);
  assert.equal(instance.writes.calendar.length, 1);
  assert.equal(instance.writes.added.length, 1);
  assert.equal(instance.writes.added[0].calendarWriteFailed, true);
  assert.equal(instance.writes.added[0].commitment.calendarWriteFailed, true);
  assert.ok(instance.alerts.some(args => /sync/i.test(String(args[1]))));
  assert.equal(instance.context.editMode, false);
});

test('adding a suggestion while editing preserves the original edit snapshot', async () => {
  const instance = screen({ editing: true });
  const originalSnapshot = [{ id: 'original', title: 'Original' }];
  instance.context.editSnapshotRef.current = originalSnapshot;
  instance.context.editHasChanges = true;
  await instance.scheduleSuggestion(instance.gap, instance.entry);
  assert.equal(instance.context.editSnapshotRef.current, originalSnapshot);
  assert.equal(instance.context.editMode, true);
  assert.equal(instance.context.editHasChanges, true);
  assertNoPersistence(instance.writes);
});

test('deleting an uncommitted suggestion removes only its local draft', async () => {
  const instance = screen();
  await instance.scheduleSuggestion(instance.gap, instance.entry);
  instance.removeCalendarActivity(instance.context.suggestionPlacement.activity.id);
  assert.equal(instance.context.suggestionPlacement, null);
  await instance.saveEditModeChanges();
  assertNoPersistence(instance.writes);
  assert.equal(instance.context.editMode, false);
});

test('a failed swipe charge leaves the draft editable and performs no calendar or activity writes', async () => {
  const instance = screen({ canSpend: false });
  await instance.scheduleSuggestion(instance.gap, instance.entry);
  await instance.saveEditModeChanges();
  assert.equal(instance.writes.spends, 1);
  assert.equal(instance.writes.calendar.length, 0);
  assert.equal(instance.writes.added.length, 0);
  assert.equal(instance.context.editMode, true);
  assert.ok(instance.context.suggestionPlacement);
  assert.equal(instance.context.editSavingRef.current, false);
});

test('a precise forced drop time is applied even when the drag delta rounds to zero', async () => {
  const instance = screen();
  await instance.scheduleSuggestion(instance.gap, instance.entry);
  const finalStart = new Date(2026, 9, 3, 9, 15);
  instance.commitEventDrag(instance.context.suggestionPlacement.activity, 0, '2026-10-03', finalStart);
  assert.equal(instance.context.suggestionPlacement.activity.startAt, finalStart.toISOString());
  assert.equal(instance.context.suggestionPlacement.activity.endAt, new Date(2026, 9, 3, 9, 45).toISOString());
  assertNoPersistence(instance.writes);
});

test('canceled and failed active gestures clear drag state without moving the draft', async () => {
  for (const stateName of ['CANCELLED', 'FAILED']) {
    const instance = screen();
    await instance.scheduleSuggestion(instance.gap, instance.entry);
    const draft = instance.context.suggestionPlacement.activity;
    instance.handleDragStateChange(draft, instance.context.State.ACTIVE, 0, 0, 0, 200, 300);
    assert.equal(instance.context.draggingBlockId, draft.id);
    instance.handleDragStateChange(draft, instance.context.State[stateName], instance.context.State.ACTIVE, 80, 0, 200, 380);
    assert.equal(instance.context.suggestionPlacement.activity.startAt, draft.startAt);
    assert.equal(instance.context.draggingBlockId, null);
    assert.equal(instance.context.dragActivityRef.current, null);
    assert.equal(instance.context.dragStartColumnIndexRef.current, null);
    assert.equal(instance.context.dragTargetColumnIndexRef.current, null);
    assertNoPersistence(instance.writes);
  }
});

test('editing draft details remains local and final Save uses the edited title, notes, and time', async () => {
  const instance = screen();
  await instance.scheduleSuggestion(instance.gap, instance.entry);
  const finalStart = new Date(2026, 9, 3, 10, 45);
  Object.assign(instance.context, {
    selectedScheduledActivity: instance.context.suggestionPlacement.activity,
    eventEditTitle: '  A longer route  ', eventEditDescription: '  By the river  ',
    eventEditStartAt: finalStart,
  });
  await instance.saveScheduledActivityEdits();
  assertNoPersistence(instance.writes);
  assert.equal(instance.context.selectedScheduledActivity, null);
  assert.equal(instance.context.suggestionPlacement.activity.title, 'A longer route');
  assert.equal(instance.context.suggestionPlacement.activity.description, 'By the river');
  assert.equal(instance.context.suggestionPlacement.activity.startAt, finalStart.toISOString());
  await instance.saveEditModeChanges();
  assert.equal(instance.writes.calendar[0].title, 'Plan: A longer route');
  assert.equal(instance.writes.calendar[0].notes, 'By the river');
  assert.equal(instance.writes.calendar[0].startDate.getTime(), finalStart.getTime());
  assert.equal(instance.writes.added[0].title, 'A longer route');
  assert.equal(instance.writes.added[0].suggestion.title, 'A longer route');
  assert.equal(instance.writes.added[0].commitment.title, 'A longer route');
});

test('a todo moved beyond its deadline stays editable without spending or writing on Save', async () => {
  const linkedTodo = {
    id: 'todo-1', title: 'A walk', done: false,
    deadlineAt: new Date(2026, 9, 3, 10).toISOString(),
  };
  const instance = screen({ linkedTodo });
  const checkedWindows = [];
  instance.context.isTodoEligibleForWindow = (todo, startAt, endAt, timeZone) => {
    checkedWindows.push({ todo, startAt, endAt, timeZone });
    return endAt.getTime() <= new Date(todo.deadlineAt).getTime();
  };
  await instance.scheduleSuggestion(instance.gap, instance.entry);
  const invalidStart = new Date(2026, 9, 3, 10, 30);
  await instance.rescheduleActivityTime(instance.context.suggestionPlacement.activity, invalidStart);
  await instance.saveEditModeChanges();
  assertNoPersistence(instance.writes);
  assert.equal(checkedWindows.length, 1);
  assert.equal(checkedWindows[0].todo, linkedTodo);
  assert.equal(checkedWindows[0].startAt.getTime(), invalidStart.getTime());
  assert.equal(checkedWindows[0].endAt.getTime(), invalidStart.getTime() + 30 * 60000);
  assert.equal(checkedWindows[0].timeZone, 'Europe/Berlin');
  assert.equal(instance.context.editMode, true);
  assert.equal(instance.context.suggestionPlacement.activity.startAt, invalidStart.toISOString());
  assert.equal(instance.context.editSavingRef.current, false);
  assert.ok(instance.alerts.some(args => args[0] === 'Invalid scheduling time'));
});

test('an existing calendar move finishes its app update while a draft save is pending', async () => {
  const { entry } = fixture();
  const existing = {
    id: 'existing-1', title: 'Existing plan', description: 'Already scheduled',
    startAt: new Date(2026, 9, 3, 13).toISOString(),
    endAt: new Date(2026, 9, 3, 13, 30).toISOString(), durationMin: 30,
    type: 'AT_HOME', suggestion: entry.deck, calendarEventId: 'existing-calendar-event',
    commitment: { calendarEventId: 'existing-calendar-event' },
  };
  const pendingMove = deferred();
  const pendingDraft = deferred();
  const instance = screen({
    existing: [existing],
    calendarCreate: event => event.title === existing.title ? pendingMove.promise : pendingDraft.promise,
  });
  await instance.scheduleSuggestion(instance.gap, instance.entry);
  const finalExistingStart = new Date(2026, 9, 3, 14);
  const move = instance.rescheduleActivityTime(existing, finalExistingStart);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(instance.writes.calendar.length, 1);
  const save = instance.saveEditModeChanges();
  assert.equal(instance.context.editSavingRef.current, true);
  assert.equal(instance.writes.calendar.length, 2);

  const draft = instance.context.suggestionPlacement.activity;
  instance.updateCalendarActivity({ ...draft, title: 'A late draft change' });
  assert.equal(instance.context.suggestionPlacement.activity.title, draft.title);

  pendingMove.resolve('moved-existing-event');
  await move;
  assert.equal(instance.context.editSavingRef.current, true);
  assert.equal(instance.writes.updated.length, 1);
  assert.equal(instance.writes.updated[0].id, existing.id);
  assert.equal(instance.writes.updated[0].item.startAt, finalExistingStart.toISOString());
  assert.equal(instance.writes.updated[0].item.calendarEventId, 'moved-existing-event');
  assert.equal(instance.context.state.scheduledActivities[0].startAt, finalExistingStart.toISOString());

  pendingDraft.resolve('new-draft-event');
  await save;
  assert.equal(instance.writes.added.length, 1);
  assert.equal(instance.writes.added[0].title, draft.title);
  assert.equal(instance.writes.added[0].calendarEventId, 'new-draft-event');
  assert.equal(instance.context.editMode, false);
});
