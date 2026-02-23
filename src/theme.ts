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
    info: string;
    infoText: string;
    success: string;
    successText: string;
    danger: string;
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
    sm: number;
    md: number;
    lg: number;
    xl: number;
  };
};

export const lightTheme: Theme = {
  isDark: false,
  colors: {
    background: '#F6F7FB',
    backgroundAlt: '#ECEEF5',
    card: '#FFFFFF',
    text: '#111111',
    textMuted: '#5A5A5A',
    border: '#D8DCE8',
    accent: '#4169E1',
    accentDark: '#3457C0',
    accentSoft: '#D6E0FA',
    accentText: '#FFFFFF',
    info: '#6495ED',
    infoText: '#FFFFFF',
    success: '#2D8C6A',
    successText: '#FFFFFF',
    danger: '#C93A2D',
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
    sm: 10,
    md: 16,
    lg: 22,
    xl: 30,
  },
};

export const darkTheme: Theme = {
  isDark: true,
  colors: {
    background: '#121520',
    backgroundAlt: '#1A1E2E',
    card: '#222738',
    text: '#EEF0F6',
    textMuted: '#A0A8C0',
    border: '#2E3348',
    accent: '#6495ED',
    accentDark: '#5A87D8',
    accentSoft: '#2A3050',
    accentText: '#121520',
    info: '#6495ED',
    infoText: '#FFFFFF',
    success: '#6ED4A8',
    successText: '#121520',
    danger: '#F28B82',
    overlay: 'rgba(0,0,0,0.6)',
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
    sm: 10,
    md: 16,
    lg: 22,
    xl: 30,
  },
};

export const theme = lightTheme;
