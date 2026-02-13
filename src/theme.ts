export type Theme = {
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
  colors: {
    background: '#F7F4EE',
    backgroundAlt: '#EFE8DD',
    card: '#FFFFFF',
    text: '#111111',
    textMuted: '#5A5A5A',
    border: '#E6E0D8',
    accent: '#FF6A3D',
    accentDark: '#E6532D',
    accentSoft: '#FFD4C8',
    accentText: '#FFFFFF',
    info: '#2563EB',
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
  colors: {
    background: '#1C1A18',
    backgroundAlt: '#24211F',
    card: '#2B2623',
    text: '#F5F1EA',
    textMuted: '#C8C0B6',
    border: '#3A322E',
    accent: '#F5E9D9',
    accentDark: '#E6D7C2',
    accentSoft: '#3A2F2A',
    accentText: '#1C1A18',
    info: '#4C8DFF',
    infoText: '#FFFFFF',
    success: '#6ED4A8',
    successText: '#1C1A18',
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
