import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useI18n } from '../i18n/I18nProvider';
import { useTheme } from '../theme/ThemeProvider';

type Props = {
  unreadCount: number;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
  deckColors?: { bg: string; text: string };
};

export const SessionMapButton: React.FC<Props> = ({ unreadCount, onPress, active, disabled, deckColors }) => {
  const theme = useTheme();
  const { language } = useI18n();
  const de = language === 'de';
  const count = Math.max(0, Math.floor(unreadCount));
  const label = de ? 'Karte dieser Session' : 'Session map';
  return (
    <Pressable
      testID="session-map-button"
      accessibilityRole="button"
      accessibilityLabel={`${label}${count ? `, ${count} ${de ? 'neue Aktivitäten' : 'new activities'}` : ''}`}
      accessibilityHint={de ? 'Nicht gewählte Aktivitäten ansehen' : 'Revisit activities you have not chosen'}
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, {
        backgroundColor: active ? deckColors?.bg ?? theme.colors.accent : theme.colors.card,
        borderColor: active ? deckColors?.bg ?? theme.colors.accent : theme.colors.border,
        opacity: disabled ? 0.45 : pressed ? 0.72 : 1,
        shadowColor: theme.colors.shadow,
      }]}
    >
      <Text accessibilityElementsHidden importantForAccessibility="no" style={styles.icon}>🗺️</Text>
      {count > 0 && <View pointerEvents="none" style={[styles.badge, { borderColor: theme.colors.background }]}>
        <Text maxFontSizeMultiplier={1.1} style={[styles.count, { fontFamily: theme.fonts.semibold }]}>{count > 99 ? '99+' : count}</Text>
      </View>}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  button: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 5, elevation: 2 },
  icon: { fontSize: 25, lineHeight: 31 },
  badge: { position: 'absolute', right: -5, top: -5, minWidth: 22, height: 22, borderRadius: 11, borderWidth: 2, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: '#C92E37' },
  count: { color: '#FFFFFF', fontSize: 10, lineHeight: 14 },
});
