const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), test = require('node:test'), ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: 'Fragment' };
let hooks = [], cursor = 0;
function useState(initial) { const state = hooks, index = cursor++; if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial; return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; }
const cache = new Map();
function load(relative) {
  const file = path.resolve(root, relative);
  if (cache.has(file)) return cache.get(file);
  const exports = {}; cache.set(file, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, { exports, require(name) {
    if (name === 'react') return { __esModule: true, default: react, useState, useRef: value => ({ current: value }), useEffect() {}, useMemo: fn => fn() };
    if (name === 'react-native') return { View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', StyleSheet: { create: x => x, absoluteFill: {}, hairlineWidth: 1 } };
    if (name === 'react-native-maps') return { __esModule: true, default: 'MapView', Marker: 'Marker' };
    if (name.endsWith('I18nProvider')) return { useI18n: () => ({ language: 'de' }) };
    if (name.endsWith('ThemeProvider')) return { useTheme: () => load('src/theme.ts').lightTheme };
    if (name === './SessionActivityMap') return { SessionActivityMap: 'SessionActivityMap' };
    const target = path.resolve(path.dirname(file), name); return load(fs.existsSync(target + '.ts') ? target + '.ts' : target + '.tsx');
  } });
  return exports;
}
function nodes(tree, type, out = []) { if (Array.isArray(tree)) tree.forEach(child => nodes(child, type, out)); else if (tree && typeof tree === 'object') { if (tree.type === type) out.push(tree); nodes(tree.props?.children, type, out); } return out; }
const origin = { latitude: 52.52, longitude: 13.405 };
const makeOption = (id, lat, lng) => ({ suggestion: { id, title: id, type: 'GO_OUT' }, coordinate: { latitude: lat, longitude: lng }, emoji: '☕', travelMode: 'walk', travelMin: 8 });
const options = [makeOption('a', 52.52, 13.405), makeOption('b', 52.52, 13.405), makeOption('c', 52.53, 13.405), makeOption('d', 52.49, 13.49)];
const helpers = load('src/components/SessionActivityMap.types.ts');
const NativeMap = load('src/components/SessionActivityMap.native.tsx').SessionActivityMap;
function render(props) { hooks = []; cursor = 0; return NativeMap(props); }

test('clusters co-located ideas without deleting any activity and separates distant pins', () => {
  const viewport = helpers.sessionMapViewport(origin, options);
  const clusters = helpers.clusterSessionActivities(options, viewport, 350, 178);
  assert.equal(clusters.reduce((sum, item) => sum + item.activities.length, 0), 4);
  assert.ok(clusters.some(cluster => cluster.activities.some(item => item.suggestion.id === 'a') && cluster.activities.some(item => item.suggestion.id === 'b')));
  assert.ok(clusters.length > 1);
});

test('zoom grouping filters invalid coordinates and duplicate IDs, and respects the date line', () => {
  const activities = [makeOption('a', 0, 179.999), makeOption('b', 0, -179.999), makeOption('invalid', 91, 0), makeOption('a', 1, 2)];
  const viewport = helpers.sessionMapViewport(null, activities.slice(0, 2));
  assert.ok(viewport.longitudeDelta < .02);
  const clusters = helpers.clusterSessionActivities(activities, viewport, 320, 178);
  assert.equal(clusters.reduce((sum, item) => sum + item.activities.length, 0), 2);
  const near = [makeOption('one', 52.52, 13.405), makeOption('two', 52.5205, 13.4055)];
  const farView = { latitude: 52.52, longitude: 13.405, latitudeDelta: .1, longitudeDelta: .1 };
  assert.equal(helpers.clusterSessionActivities(near, farView, 320, 178).length, 1);
  assert.equal(helpers.clusterSessionActivities(near, { ...farView, latitudeDelta: .001, longitudeDelta: .001 }, 320, 178).length, 2);
});

test('native map allows panning and zoom and routes grouped versus single marker taps', () => {
  const selected = [], groups = [];
  const tree = render({ origin, activities: options, onSelect: id => selected.push(id), onSelectGroup: ids => groups.push(ids) });
  const map = nodes(tree, 'MapView')[0];
  assert.ok(map); assert.equal(map.props.scrollEnabled, true); assert.equal(map.props.zoomEnabled, true);
  assert.equal(map.props.region, undefined, 'camera remains uncontrolled after initial fit');
  assert.ok(map.props.initialRegion); assert.equal(typeof map.props.onRegionChangeComplete, 'function');
  let stopped = 0;
  for (const marker of nodes(tree, 'Marker').filter(item => item.props.onPress)) marker.props.onPress({ stopPropagation() { stopped++; } });
  assert.ok(groups.length); assert.ok(selected.length); assert.equal(stopped, groups.length + selected.length);
  assert.equal(groups.flat().length + selected.length, options.length);
  const noOrigin = render({ activities: options, origin: null, onSelect() {}, onSelectGroup() {} });
  assert.equal(nodes(noOrigin, 'Marker').filter(item => item.props.tappable === false).length, 0, 'unknown user position never appears as a fake pin');
});

test('panel lists every entry including home and unlocated suggestions, with saved labels', () => {
  const Panel = load('src/components/SessionMapPanel.tsx').SessionMapPanel;
  const entries = Array.from({ length: 18 }, (_, index) => ({ suggestion: { id: `idea-${index}`, title: `Idea ${index}`, type: index % 2 ? 'AT_HOME' : 'GO_OUT' }, saved: index === 2, addedAt: index, unread: true }));
  const selected = [];
  hooks = []; cursor = 0;
  const tree = Panel({ entries, activities: [], origin: null, onSelect: id => selected.push(id) });
  assert.equal(nodes(tree, 'SessionActivityMap').length, 0);
  const rows = nodes(tree, 'Pressable'); assert.equal(rows.length, 18);
  assert.match(rows[1].props.accessibilityLabel, /Zu Hause/); assert.match(rows[2].props.accessibilityLabel, /Gespeichert/);
  rows[17].props.onPress(); assert.deepEqual(selected, ['idea-17']);
});

test('map button has a 48px target, capped visual badge, full accessible count and active state', () => {
  const Button = load('src/components/SessionMapButton.tsx').SessionMapButton;
  let presses = 0;
  const tree = Button({ unreadCount: 120, active: true, onPress() { presses++; } });
  assert.match(tree.props.accessibilityLabel, /120 neue Aktivitäten/);
  assert.equal(tree.props.accessibilityState.selected, true);
  assert.equal(tree.props.style({ pressed: false })[0].width, 48);
  assert.ok(nodes(tree, 'Text').some(node => node.props.children.includes('99+')));
  tree.props.onPress(); assert.equal(presses, 1);
  assert.equal(nodes(Button({ unreadCount: 0, onPress() {} }), 'Text').length, 1);
});
