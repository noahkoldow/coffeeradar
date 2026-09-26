const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Run actual handlers with controlled state, without native calendars or network calls.
function loadFunctions(relativePath, names, context) {
  const sourcePath = path.resolve(__dirname, relativePath);
  const source = fs.readFileSync(sourcePath, 'utf8');
  const tree = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map();
  function visit(node) {
    if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(tree))) {
      declarations.set(node.name.getText(tree), node.initializer.getText(tree));
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  for (const name of names) assert.ok(declarations.has(name), `${name} exists in ${relativePath}`);
  const compiled = ts.transpileModule(
    names.map(name => `const ${name} = ${declarations.get(name)}; exports.${name} = ${name};`).join('\n'),
    { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } },
  ).outputText;
  context.exports = {};
  vm.runInNewContext(compiled, context);
  return context.exports;
}

const plain = value => JSON.parse(JSON.stringify(value));

function loadLocalModule(relativePath, dependencies = {}) {
  const source = fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
  const exports = {};
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports, Date, Intl,
    require(name) {
      assert.ok(dependencies[name], `Unexpected module ${name}`);
      return dependencies[name];
    },
  });
  return exports;
}

const time = loadLocalModule('../src/utils/time.ts');
const todos = loadLocalModule('../src/utils/todos.ts', { './time': time });

function todo(overrides = {}) {
  return {
    id: 'todo-1', title: 'Original title', notes: 'Original notes',
    dueDate: '2026-10-03', deadlineAt: null, hasFixedSchedule: false,
    done: false, createdAt: '2026-09-20T12:00:00Z',
    atomizedTotalMin: 90, atomizedProgressMin: 30,
    scheduledAt: '2026-10-03T09:00:00Z', scheduledEndAt: '2026-10-03T09:30:00Z',
    scheduledMode: 'smart', linkedScheduledActivityId: 'activity-1',
    completionPromptedAt: '2026-09-21T15:00:00Z', planReason: 'Existing reason',
    ...overrides,
  };
}

function activity(overrides = {}) {
  return {
    id: 'activity-1', title: 'Original title', description: 'Original notes',
    startAt: '2026-10-03T09:00:00Z', endAt: '2026-10-03T09:30:00Z', durationMin: 30,
    calendarEventId: 'event-1',
    suggestion: { title: 'Original title', description: 'Original notes', meta: { source: 'todo' } },
    commitment: { title: 'Original title', startAt: '2026-10-03T09:00:00Z', endAt: '2026-10-03T09:30:00Z', calendarEventId: 'event-1' },
    ...overrides,
  };
}

function screen({ existing = todo(), linked = null, calendarUpdate = async () => {} } = {}) {
  const writes = { added: [], todos: [], activities: [], calendar: [], schedules: [] };
  const state = { userId: 'user-1', smartTodos: existing ? [existing] : [], scheduledActivities: linked ? [linked] : [] };
  const context = {
    Date, Intl, Promise,
    isGerman: false, timeZone: 'Europe/Berlin', state,
    editingTodoId: existing?.id ?? null, todoTitle: 'Revised title', todoNotes: 'Revised notes',
    todoDeadlineAt: new Date(2026, 9, 3, 12), todoHasExplicitTime: false, todoDateChanged: false,
    todoFormModalOpen: true, todoModalOpen: false, todoFormError: '', todoSaving: false,
    todoSavingRef: { current: false }, todoEditorStateRef: { current: state },
    ...todos,
    actions: {
      addSmartTodo(item) { writes.added.push(plain(item)); },
      updateSmartTodo(item) { writes.todos.push(plain(item)); },
      updateScheduledActivity(id, item) { writes.activities.push({ id, item: plain(item) }); },
    },
    async updatePlanEventDetails(...args) {
      writes.calendar.push(plain(args));
      return calendarUpdate(...args);
    },
    hasClearTodoDateTime: () => true,
    SMART_TODO_DEFAULT_DURATION_MIN: 30,
    scheduleTodoAt(...args) { writes.schedules.push(plain(args)); return Promise.resolve(); },
  };
  for (const field of ['editingTodoId', 'todoTitle', 'todoNotes', 'todoDeadlineAt', 'todoHasExplicitTime',
    'todoDateChanged', 'todoFormError', 'todoDatePickerVisible', 'todoTimePickerVisible',
    'todoModalOpen', 'todoFormModalOpen', 'todoSaving']) {
    context[`set${field[0].toUpperCase()}${field.slice(1)}`] = value => { context[field] = value; };
  }
  const handlers = loadFunctions('../src/screens/SmartCalendarScreen.tsx', ['openTodoForm', 'closeTodoForm', 'saveTodo'], context);
  return { context, writes, ...handlers };
}

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

test('editing saves the same task and preserves completion, progress, and existing dates', async () => {
  const existing = todo({ done: true, deadlineAt: '2026-10-03T00:00:00.000Z' });
  const instance = screen({ existing });
  instance.context.todoTitle = '  Revised title  ';
  await instance.saveTodo();
  assert.deepEqual(instance.writes.todos, [{ ...existing, title: 'Revised title', notes: 'Revised notes' }]);
  assert.equal(instance.writes.added.length, 0);
  assert.equal(instance.writes.schedules.length, 0);
  assert.equal(instance.context.todoFormModalOpen, false);
  assert.equal(instance.context.todoModalOpen, true);
});

test('opening a date-only task preserves its calendar day and cancel does not write', () => {
  const instance = screen();
  instance.openTodoForm(todo());
  assert.equal(instance.context.todoDeadlineAt.getFullYear(), 2026);
  assert.equal(instance.context.todoDeadlineAt.getMonth(), 9);
  assert.equal(instance.context.todoDeadlineAt.getDate(), 3);
  assert.equal(instance.context.todoHasExplicitTime, false);
  instance.context.todoTitle = 'Unsaved change';
  instance.closeTodoForm();
  assert.deepEqual(instance.writes, { added: [], todos: [], activities: [], calendar: [], schedules: [] });
  assert.equal(instance.context.todoFormModalOpen, false);
  assert.equal(instance.context.todoModalOpen, true);
});

test('blank titles and invalid dates keep the editor open without writes', async () => {
  for (const fields of [{ todoTitle: '  ' }, { todoDeadlineAt: new Date('invalid') }]) {
    const instance = screen();
    Object.assign(instance.context, fields);
    await instance.saveTodo();
    assert.ok(instance.context.todoFormError);
    assert.equal(instance.context.todoFormModalOpen, true);
    assert.equal(instance.writes.todos.length, 0);
    assert.equal(instance.writes.added.length, 0);
  }
});

test('clearing a deadline and notes keeps the existing scheduled slot and progress', async () => {
  const existing = todo({ deadlineAt: '2026-10-03T09:00:00Z', dueDate: null, hasFixedSchedule: true });
  const instance = screen({ existing, linked: activity() });
  Object.assign(instance.context, { todoNotes: '  ', todoDeadlineAt: null, todoDateChanged: true });
  await instance.saveTodo();
  const saved = instance.writes.todos[0];
  assert.equal(saved.deadlineAt, null);
  assert.equal(saved.dueDate, null);
  assert.equal(saved.hasFixedSchedule, false);
  assert.equal(saved.notes, undefined);
  assert.equal(saved.scheduledAt, existing.scheduledAt);
  assert.equal(saved.atomizedProgressMin, existing.atomizedProgressMin);
  assert.deepEqual(instance.writes.calendar, [['event-1', { title: 'To-do: Revised title', notes: '' }]]);
  assert.equal(instance.writes.activities[0].item.startAt, existing.scheduledAt);
  assert.equal(instance.writes.activities[0].item.description, '');
  assert.equal(instance.writes.schedules.length, 0);
});

test('an edited due day saves the displayed local day without rescheduling', async () => {
  const instance = screen();
  Object.assign(instance.context, { todoDeadlineAt: new Date(2026, 10, 14, 12), todoDateChanged: true });
  await instance.saveTodo();
  assert.equal(instance.writes.todos[0].dueDate, '2026-11-14');
  assert.equal(instance.writes.todos[0].deadlineAt, null);
  assert.equal(instance.writes.todos[0].scheduledAt, todo().scheduledAt);
  assert.equal(instance.writes.schedules.length, 0);
});

test('linked task edits synchronize nested activity content and fallback calendar IDs', async () => {
  const instance = screen({ linked: activity({ calendarEventId: undefined }) });
  await instance.saveTodo();
  const saved = instance.writes.activities[0].item;
  assert.deepEqual(instance.writes.calendar, [['event-1', { title: 'To-do: Revised title', notes: 'Revised notes' }]]);
  assert.equal(saved.title, 'Revised title');
  assert.equal(saved.description, 'Revised notes');
  assert.equal(saved.suggestion.title, 'Revised title');
  assert.equal(saved.suggestion.description, 'Revised notes');
  assert.equal(saved.suggestion.meta.source, 'todo');
  assert.equal(saved.commitment.title, 'Revised title');
  assert.equal(saved.commitment.calendarEventId, 'event-1');
  assert.equal(saved.startAt, activity().startAt);
});

test('calendar failure leaves all local records and the editing draft intact', async () => {
  const instance = screen({ linked: activity(), calendarUpdate: async () => { throw new Error('Denied'); } });
  await instance.saveTodo();
  assert.equal(instance.writes.todos.length, 0);
  assert.equal(instance.writes.activities.length, 0);
  assert.equal(instance.context.todoTitle, 'Revised title');
  assert.equal(instance.context.todoFormModalOpen, true);
  assert.match(instance.context.todoFormError, /not been saved/);
  assert.equal(instance.context.todoSavingRef.current, false);
  assert.equal(instance.context.todoSaving, false);
});

test('repeated save and cancel taps cannot interrupt an in-flight calendar edit', async () => {
  const pending = deferred();
  const instance = screen({ linked: activity(), calendarUpdate: () => pending.promise });
  const saving = instance.saveTodo();
  await instance.saveTodo();
  instance.closeTodoForm();
  assert.equal(instance.writes.calendar.length, 1);
  assert.equal(instance.context.todoFormModalOpen, true);
  assert.equal(instance.writes.todos.length, 0);
  pending.resolve();
  await saving;
  assert.equal(instance.writes.todos.length, 1);
});

test('progress updates made during calendar sync are preserved', async () => {
  const pending = deferred();
  const instance = screen({ linked: activity(), calendarUpdate: () => pending.promise });
  const saving = instance.saveTodo();
  instance.context.todoEditorStateRef.current = {
    ...instance.context.state,
    smartTodos: [todo({ atomizedProgressMin: 90, done: true })],
  };
  pending.resolve();
  await saving;
  assert.equal(instance.writes.todos[0].atomizedProgressMin, 90);
  assert.equal(instance.writes.todos[0].done, true);
});

test('rescheduling during calendar sync does not restore the old activity slot', async () => {
  const pending = deferred();
  const instance = screen({ linked: activity(), calendarUpdate: () => pending.promise });
  const saving = instance.saveTodo();
  const startAt = '2026-10-04T12:00:00Z';
  const endAt = '2026-10-04T12:30:00Z';
  const latestActivity = activity({ startAt, endAt, commitment: { ...activity().commitment, startAt, endAt } });
  instance.context.todoEditorStateRef.current = {
    ...instance.context.state,
    smartTodos: [todo({ scheduledAt: startAt, scheduledEndAt: endAt })],
    scheduledActivities: [latestActivity],
  };
  pending.resolve();
  await saving;
  assert.equal(instance.writes.todos[0].scheduledAt, startAt);
  assert.equal(instance.writes.activities[0].item.startAt, startAt);
  assert.equal(instance.writes.activities[0].item.endAt, endAt);
  assert.equal(instance.writes.activities[0].item.commitment.startAt, startAt);
});

test('a task removed during calendar sync is not recreated', async () => {
  const pending = deferred();
  const instance = screen({ linked: activity(), calendarUpdate: () => pending.promise });
  const saving = instance.saveTodo();
  instance.context.todoEditorStateRef.current = { ...instance.context.state, smartTodos: [], scheduledActivities: [] };
  pending.resolve();
  await saving;
  assert.equal(instance.writes.todos.length, 0);
  assert.equal(instance.writes.added.length, 0);
  assert.equal(instance.writes.activities.length, 0);
  assert.match(instance.context.todoFormError, /removed/);
  assert.equal(instance.context.todoFormModalOpen, true);
});

test('starting a new task after editing clears the draft and creates one new record', async () => {
  const instance = screen();
  instance.openTodoForm(todo());
  instance.closeTodoForm();
  instance.openTodoForm();
  assert.equal(instance.context.editingTodoId, null);
  assert.equal(instance.context.todoTitle, '');
  assert.equal(instance.context.todoNotes, '');
  assert.equal(instance.context.todoDeadlineAt, null);
  instance.context.todoTitle = 'New task';
  instance.context.todoNotes = 'New notes';
  await instance.saveTodo();
  assert.equal(instance.writes.added.length, 1);
  assert.equal(instance.writes.added[0].title, 'New task');
  assert.equal(instance.writes.added[0].notes, 'New notes');
  assert.notEqual(instance.writes.added[0].id, 'todo-1');
  assert.equal(instance.writes.todos.length, 0);
});

test('account changes during calendar sync prevent local writes to another account', async () => {
  const pending = deferred();
  const instance = screen({ linked: activity(), calendarUpdate: () => pending.promise });
  const saving = instance.saveTodo();
  instance.context.todoEditorStateRef.current = { userId: 'user-2', smartTodos: [], scheduledActivities: [] };
  pending.resolve();
  await saving;
  assert.equal(instance.writes.todos.length, 0);
  assert.equal(instance.writes.activities.length, 0);
});

test('native calendar text edits update the existing event without changing its time', async () => {
  const calls = [];
  const { updatePlanEventDetails } = loadFunctions('../src/services/calendar.native.ts', ['updatePlanEventDetails'], {
    Calendar: { updateEventAsync: async (...args) => calls.push(args) },
  });
  await updatePlanEventDetails('event-1', { title: 'To-do: Revised title', notes: '' });
  assert.deepEqual(plain(calls), [['event-1', { title: 'To-do: Revised title', notes: '' }]]);
});

test('calendar text edit failures propagate to the editor', async () => {
  const { updatePlanEventDetails } = loadFunctions('../src/services/calendar.native.ts', ['updatePlanEventDetails'], {
    Calendar: { updateEventAsync: async () => { throw new Error('Calendar access denied'); } },
  });
  await assert.rejects(updatePlanEventDetails('event-1', { title: 'Revised title' }), /Calendar access denied/);
});

test('web cannot report a native calendar edit as successful', async () => {
  const { updatePlanEventDetails } = loadFunctions('../src/services/calendar.web.ts', ['updatePlanEventDetails'], {});
  await assert.rejects(updatePlanEventDetails('event-1', { title: 'Revised title' }), /Calendar not supported on web/);
});
