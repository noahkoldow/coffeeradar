import { lightTheme, darkTheme } from '../../src/theme';
export const useTheme = () => new URLSearchParams(window.location.search).get('theme') === 'dark' ? darkTheme : lightTheme;
export const useI18n = () => ({ language: new URLSearchParams(window.location.search).get('language') || 'en' });
