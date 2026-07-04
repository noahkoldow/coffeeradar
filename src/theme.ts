export type Theme = {
  isDark: boolean;
  colors: {
    background: string;
    backgroundAlt: string;
    card: string;
    text: string;
    textMuted: string;
    border: string;
    accent: string;
    accentDark: string;
    accentSoft: string;
    accentText: string;
    accentDim: string;
    info: string;
    infoText: string;
    success: string;
    successText: string;
    danger: string;
    error: string;
    surface: string;
    overlay: string;
    shadow: string;
  };
  fonts: {
    heading: string;
    semibold: string;
    body: string;
  };
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
  };
  radius: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    full: number;
  };
};

export const lightTheme: Theme = {
  isDark: false,
  colors: {
    background: '#FCFCFA',
    backgroundAlt: '#FCFCFA',
    card: '#FCFCFA',
    text: '#111111',
    textMuted: '#5A5A5A',
    border: '#E3E7F1',
    accent: '#4169E1',
    accentDark: '#3457C0',
    accentSoft: '#D6E0FA',
    accentDim: '#E8ECFA',
    accentText: '#FFFFFF',
    info: '#6495ED',
    infoText: '#FFFFFF',
    success: '#2D8C6A',
    successText: '#FFFFFF',
    danger: '#C93A2D',
    error: '#FF4D4F',
    surface: '#FCFCFA',
    overlay: 'rgba(0,0,0,0.45)',
    shadow: '#000000',
  },
  fonts: {
    heading: 'SpaceGrotesk_700Bold',
    semibold: 'SpaceGrotesk_600SemiBold',
    body: 'SpaceGrotesk_400Regular',
  },
  spacing: {
    xs: 6,
    sm: 10,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 40,
  },
  radius: {
    xs: 6,
    sm: 10,
    md: 16,
    lg: 22,
    xl: 30,
    full: 9999,
  },
};

export const darkTheme: Theme = {
  isDark: true,
  colors: {
    background: '#0F1218',
    backgroundAlt: '#171C24',
    card: '#1E2530',
    text: '#EEF2F8',
    textMuted: '#A5AEC0',
    border: '#384357',
    accent: '#78A8FF',
    accentDark: '#5E8FE8',
    accentSoft: '#223551',
    accentDim: '#2C3950',
    accentText: '#0D1626',
    info: '#78A8FF',
    infoText: '#FFFFFF',
    success: '#5BC49A',
    successText: '#0E1A16',
    danger: '#F27D7D',
    error: '#FF6B6B',
    surface: '#1E2530',
    overlay: 'rgba(0,0,0,0.65)',
    shadow: '#000000',
  },
  fonts: {
    heading: 'SpaceGrotesk_700Bold',
    semibold: 'SpaceGrotesk_600SemiBold',
    body: 'SpaceGrotesk_400Regular',
  },
  spacing: {
    xs: 6,
    sm: 10,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 40,
  },
  radius: {
    xs: 6,
    sm: 10,
    md: 16,
    lg: 22,
    xl: 30,
    full: 9999,
  },
};

export const theme = lightTheme;
