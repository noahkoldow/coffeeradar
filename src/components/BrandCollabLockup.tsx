import React, { useMemo } from 'react';
import { Image, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useAppState } from '../state/AppState';
import { useTheme } from '../theme/ThemeProvider';

type BrandCollabLockupProps = {
  height?: number;
  bitsWidth?: number;
  style?: StyleProp<ViewStyle>;
};

export const BrandCollabLockup: React.FC<BrandCollabLockupProps> = ({
  height = 30,
  bitsWidth,
  style,
}) => {
  const theme = useTheme();
  const { state } = useAppState();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const bitsLogo = state.isPremium
    ? require('../../assets/logo_premium.png')
    : require('../../assets/logo.png');

  const logoWidth = bitsWidth ?? height * 3;
  const partnerSize = Math.max(20, Math.round(height * 0.95));
  const businessLogoUrl = state.businessProfile?.logo?.url;

  return (
    <View style={[styles.container, style]}>
      <Image source={bitsLogo} style={{ width: logoWidth, height }} resizeMode="contain" />
      {businessLogoUrl ? (
        <>
          <Text style={[styles.collabDivider, { fontSize: Math.max(11, Math.round(height * 0.4)) }]}>X</Text>
          <Image
            source={{ uri: businessLogoUrl }}
            style={{
              width: partnerSize,
              height: partnerSize,
              borderRadius: Math.round(partnerSize * 0.25),
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.backgroundAlt,
            }}
            resizeMode="cover"
          />
        </>
      ) : null}
    </View>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    collabDivider: {
      fontFamily: theme.fonts.semibold,
      color: theme.colors.textMuted,
      letterSpacing: 0.6,
      marginHorizontal: 2,
    },
  });
