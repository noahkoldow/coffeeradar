import React, { createContext, useContext, useMemo } from 'react';
import { useAppState } from '../state/AppState';
import { darkTheme, lightTheme, Theme } from '../theme';

const ThemeContext = createContext<Theme>(lightTheme);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { state } = useAppState();
  const theme = useMemo(() => {
    return state.prefs.themeMode === 'dark' ? darkTheme : lightTheme;
  }, [state.prefs.themeMode]);

  return (
    <ThemeContext.Provider value={theme}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
