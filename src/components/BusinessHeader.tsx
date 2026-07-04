import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';

interface BusinessHeaderProps {
  onSettingsPress?: () => void;
  showSettingsIcon?: boolean;
}

export const BusinessHeader: React.FC<BusinessHeaderProps> = ({ onSettingsPress, showSettingsIcon = true }) => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.content}>
        <View style={styles.logoSection}>
          <Image
            source={require('../../assets/logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.businessText}>BUSINESS</Text>
        </View>

        {showSettingsIcon && (
          <Pressable onPress={onSettingsPress} style={styles.settingsButton}>
            <Text style={styles.settingsIcon}>⚙️</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
};

const createStyles = (theme: any) =>
  StyleSheet.create({
    container: {
      backgroundColor: theme.colors.background,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border || '#f0f0f0',
      paddingHorizontal: theme.spacing.md,
      paddingBottom: theme.spacing.md,
    },
    content: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    logoSection: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    logo: {
      width: 32,
      height: 32,
    },
    businessText: {
      fontSize: 14,
      fontWeight: '800',
      letterSpacing: 1.5,
      color: theme.colors.text,
    },
    settingsButton: {
      padding: theme.spacing.sm,
      borderRadius: 8,
      backgroundColor: theme.colors.backgroundAlt,
    },
    settingsIcon: {
      fontSize: 20,
    },
  });
