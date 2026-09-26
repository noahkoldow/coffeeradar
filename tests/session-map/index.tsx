import React, { useState } from 'react';
import { registerRootComponent } from 'expo';
import { Pressable, Text, View } from 'react-native';
import { useFonts, SpaceGrotesk_400Regular, SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import type { MapActivityOption } from '../../src/components/ActivityMap.types';
import type { SessionMapEntry } from '../../src/services/sessionMap';
import { SessionMapPanel } from '../../src/components/SessionMapPanel';
import { SessionMapButton } from '../../src/components/SessionMapButton';
import { SuggestionCard } from '../../src/components/SuggestionCard';
import { DeckLayout } from './DeckLayout.generated';

const query = new URLSearchParams(window.location.search);
const de = query.get('language') === 'de';
const scenario = query.get('scenario') || 'many';
const origin = { latitude: 52.52, longitude: 13.405 };
const count = scenario === 'empty' ? 0 : scenario === 'few' ? 3 : scenario === 'list' ? 8 : 17;
const entries: SessionMapEntry[] = Array.from({ length: count }, (_, index) => ({
  suggestion: {
    id: `idea-${index}`, type: scenario === 'list' || index > 12 ? 'AT_HOME' : 'GO_OUT',
    title: de ? `${index + 1}. Eine kleine Pause mit außergewöhnlich gutem Kaffee und neuen Ideen` : `${index + 1}. Find your next favourite coffee and a little inspiration`,
    description: de ? 'Entdecke etwas Neues und nimm dir Zeit für eine schöne Pause.' : 'Discover something new and take time for a lovely break.',
    durationMin: 25, confidence: 1, source: 'curated', emojis: ['☕', '🎨', '🌳'][index % 3] ? [['☕', '🎨', '🌳'][index % 3]] : ['✨'],
    tags: ['coffee'], place: index <= 12 && scenario !== 'list' ? { name: `Café ${index + 1}`, lat: 52.52 + (index % 3) * .025, lng: 13.405 + Math.floor(index / 3) * .04 } : undefined,
  },
  saved: index % 4 === 0, addedAt: index, unread: true,
}));
const activities: MapActivityOption[] = entries.filter(entry => entry.suggestion.place).map((entry, index) => ({
  suggestion: entry.suggestion,
  coordinate: scenario === 'many' && index < 3 ? { latitude: 52.52, longitude: 13.405 } : { latitude: entry.suggestion.place!.lat!, longitude: entry.suggestion.place!.lng! },
  travelMin: 8 + index, travelMode: (['walk', 'transit', 'car'] as const)[index % 3], emoji: entry.suggestion.emojis![0],
}));

function Harness() {
  const [selected, setSelected] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [unread, setUnread] = useState(query.get('badge') === 'large' ? 120 : count);
  const [loaded] = useFonts({ SpaceGrotesk_400Regular, SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold });
  const chosen = entries.find(entry => entry.suggestion.id === selected);
  if (!loaded) return <Text>Loading fonts</Text>;
  if (query.get('layout') === '1') return <DeckLayout entries={entries} activities={activities} />;
  return <View style={{ minHeight: '100%', width: '100%', paddingHorizontal: 12, paddingTop: 20, alignItems: 'center', backgroundColor: query.get('theme') === 'dark' ? '#0F1218' : '#F1F1EC' }}>
    <View testID="card-frame" style={{ width: '100%', maxWidth: 390 }}>
      {mapOpen && chosen ? <SuggestionCard suggestion={chosen.suggestion} animateEntrance={false} /> : mapOpen ? <SessionMapPanel entries={entries} activities={activities} origin={scenario === 'list' ? null : origin} onSelect={setSelected} /> : <View style={{ height: 420, backgroundColor: '#FCFCFA', borderRadius: 22, justifyContent: 'center', alignItems: 'center' }}><Text>Current swiping card</Text></View>}
      {chosen && mapOpen && <Pressable accessibilityRole="button" accessibilityLabel={de ? 'Zurück zur Karte' : 'Back to map'} onPress={() => setSelected(null)} style={{ padding: 12 }}><Text>{de ? 'Zurück zur Karte' : 'Back to map'}</Text></Pressable>}
    </View>
    <View style={{ marginTop: 12, alignItems: 'center' }}><SessionMapButton unreadCount={unread} active={mapOpen} onPress={() => { setMapOpen(value => !value); setSelected(null); setUnread(0); }} /><Text style={{ marginTop: 10, fontSize: 30 }}>♡</Text></View>
    <Text testID="selection">{selected || (mapOpen ? 'map' : 'deck')}</Text>
  </View>;
}
registerRootComponent(Harness);
