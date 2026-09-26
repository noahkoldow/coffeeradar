import React, { useRef, useState } from 'react';
import { AppRegistry } from 'react-native';
import { SwipeDeck, SwipeDeckHandle } from '../../src/components/SwipeDeck';
import type { DeckSuggestion } from '../../src/types';

const suggestions: DeckSuggestion[] = [
  {
    id: 'fixture-a', type: 'AT_HOME', source: 'curated', title: 'Make a fresh coffee',
    cta: 'Brew a fresh coffee', description: 'Take a calm break and enjoy a freshly brewed cup.',
    durationMin: 15, confidence: 1, tags: ['coffee'], emojis: ['☕', '🌿', '✨'],
    instructions: Array.from({ length: 18 }, (_, i) => `Coffee preparation step ${i + 1}: pause and enjoy the ritual.`),
  },
  {
    id: 'fixture-b', type: 'AT_HOME', source: 'curated', title: 'Read a new chapter',
    cta: 'Read a new chapter', description: 'Settle into a comfortable chair with your favourite book.',
    durationMin: 20, confidence: 1, tags: ['reading'], emojis: ['📚', '🛋️', '✨'],
    instructions: ['Pick a book.', 'Read one chapter.', 'Write down one idea.'],
  },
  {
    id: 'fixture-c', type: 'AT_HOME', source: 'curated', title: 'Stretch and reset',
    cta: 'Stretch and reset', description: 'Make room for an easy stretch and a few slow breaths.',
    durationMin: 10, confidence: 1, tags: ['wellness'], emojis: ['🌿', '🧘', '✨'],
    instructions: ['Find a comfortable space.', 'Stretch gently.', 'Take three slow breaths.'],
  },
];

type Mode = 'advance' | 'hold' | 'deferred' | 'throw';

function Harness() {
  const deck = useRef<SwipeDeckHandle>(null);
  const pending = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null);
  const [index, setIndex] = useState(0);
  const [disabled, setDisabled] = useState(false);
  const [mode, setMode] = useState<Mode>('advance');
  const [events, setEvents] = useState<Array<{ direction: string; id: string | null }>>([]);
  const [awaiting, setAwaiting] = useState(false);

  const swipe = (direction: 'left' | 'right'): void | Promise<void> => {
    setEvents((value) => [...value, { direction, id: suggestions[index]?.id ?? null }]);
    if (mode === 'throw') throw new Error('Expected fixture callback failure');
    if (mode === 'hold') return;
    if (mode === 'deferred') {
      setAwaiting(true);
      return new Promise<void>((resolve, reject) => { pending.current = { resolve, reject }; });
    }
    setIndex((value) => Math.min(value + 1, suggestions.length));
  };

  const settle = (action: 'advance' | 'hold' | 'reject') => {
    const request = pending.current;
    if (!request) return;
    pending.current = null;
    setAwaiting(false);
    if (action === 'advance') setIndex((value) => Math.min(value + 1, suggestions.length));
    if (action === 'reject') request.reject(new Error('Expected fixture callback rejection'));
    else request.resolve();
  };

  return (
    <main>
      <header><h1>Swipe deck regression fixture</h1><p>Local cards · No account · No business actions</p></header>
      <section data-testid="harness-deck" className="deck">
        <SwipeDeck ref={deck} current={suggestions[index] ?? null} next={suggestions[index + 1] ?? null}
          onSwipeLeft={() => swipe('left')} onSwipeRight={() => swipe('right')} disabled={disabled}
          deckColors={{ bg: '#8BA2C4', text: '#24344D' }} />
      </section>
      <section className="actions">
        <button data-testid="swipe-left" onClick={() => deck.current?.swipeLeft()}>Skip left</button>
        <button data-testid="undo" onClick={() => setIndex((value) => Math.max(0, value - 1))}>Undo</button>
        <button data-testid="swipe-right" onClick={() => deck.current?.swipeRight()}>Choose right</button>
      </section>
      <section className="controls">
        <label>Callback behaviour <select data-testid="callback-mode" value={mode}
          onChange={(event) => setMode(event.target.value as Mode)}>
          <option value="advance">Advance</option><option value="hold">Keep current card</option>
          <option value="deferred">Wait for completion</option><option value="throw">Throw</option>
        </select></label>
        <label><input data-testid="disabled-toggle" type="checkbox" checked={disabled}
          onChange={(event) => setDisabled(event.target.checked)} /> Disable deck</label>
        <div>
          <button data-testid="resolve-advance" onClick={() => settle('advance')}>Resolve and advance</button>
          <button data-testid="resolve-hold" onClick={() => settle('hold')}>Resolve and keep</button>
          <button data-testid="reject" onClick={() => settle('reject')}>Reject</button>
        </div>
        <output data-testid="harness-current">{suggestions[index]?.id ?? 'empty'}</output>
        <output data-testid="harness-count">{events.length}</output>
        <output data-testid="harness-pending">{String(awaiting)}</output>
        <output data-testid="harness-events">{JSON.stringify(events)}</output>
      </section>
    </main>
  );
}

AppRegistry.registerComponent('SwipeDeckFixture', () => Harness);
AppRegistry.runApplication('SwipeDeckFixture', { rootTag: document.getElementById('root') });
