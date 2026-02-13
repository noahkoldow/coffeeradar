import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StackScreenProps } from '@react-navigation/stack';
import { PrimaryButton } from '../components/PrimaryButton';
import { useTheme } from '../theme/ThemeProvider';
import { RootStackParamList } from '../navigation/types';

type Props = StackScreenProps<RootStackParamList, 'Welcome'>;

export const WelcomeScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient
      colors={[theme.colors.background, theme.colors.backgroundAlt]}
      style={[styles.container, { paddingTop: insets.top + theme.spacing.sm }]}
    >
      <View style={styles.content}>
        <Text style={styles.title}>Tap once. Do something now.</Text>
        <Text style={styles.subtitle}>We fit it to your schedule, then commit.</Text>
      </View>
      <PrimaryButton
        label="Get started"
        onPress={() => navigation.navigate('CalendarPermission')}
        style={styles.button}
      />
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.spacing.xl,
    justifyContent: 'space-between',
  },
  content: {
    marginTop: theme.spacing.xxl,
  },
  title: {
    fontFamily: theme.fonts.heading,
    fontSize: 36,
    color: theme.colors.text,
  },
  subtitle: {
    fontFamily: theme.fonts.body,
    fontSize: 18,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.md,
    maxWidth: 280,
  },
  button: {
    marginBottom: theme.spacing.xl,
  },
});
