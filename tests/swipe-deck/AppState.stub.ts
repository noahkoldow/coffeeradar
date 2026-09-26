// The real ThemeProvider imports AppState. Isolate that unrelated business state
// so this fixture never initializes authentication, storage, or remote services.
export const useAppState = () => ({ state: { prefs: { themeMode: 'light' } } });
