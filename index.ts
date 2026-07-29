import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';

if (typeof AbortSignal !== 'undefined' && typeof (AbortSignal as any).any !== 'function') {
	(AbortSignal as any).any = (signals: Array<AbortSignal | null | undefined>) => {
		const controller = new AbortController();

		const onAbort = (signal: AbortSignal) => {
			if (!controller.signal.aborted) {
				controller.abort((signal as any).reason);
			}
			cleanup();
		};

		const cleanup = () => {
			for (const signal of signals) {
				signal?.removeEventListener('abort', listeners.get(signal) as EventListener);
			}
			listeners.clear();
		};

		const listeners = new Map<AbortSignal, EventListener>();
		for (const signal of signals) {
			if (!signal) continue;
			if (signal.aborted) {
				onAbort(signal);
				return controller.signal;
			}

			const listener = () => onAbort(signal);
			listeners.set(signal, listener);
			signal.addEventListener('abort', listener);
		}

		return controller.signal;
	};
}

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
