import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';

type Props = StackScreenProps<RootStackParamList, 'CommunityIdeaSuccess'>;

export const CommunityIdeaSuccessScreen: React.FC<Props> = ({ navigation, route }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const spin = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(spin, {
        toValue: 1,
        duration: 1100,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(lift, {
          toValue: 1,
          duration: 420,
          useNativeDriver: true,
        }),
        Animated.timing(lift, {
          toValue: 0,
          duration: 360,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [lift, spin]);

  const rotateY = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const translateY = lift.interpolate({ inputRange: [0, 1], outputRange: [0, -8] });

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={styles.container}>
      <View style={[styles.content, { paddingTop: insets.top + theme.spacing.md, paddingBottom: insets.bottom + theme.spacing.lg }]}>
        <Animated.View style={[styles.cardShell, { transform: [{ perspective: 1200 }, { rotateY }, { translateY }] }]}>
          <LinearGradient colors={[theme.colors.accent, theme.colors.accentDim]} style={styles.cardGlow}>
            <View style={styles.mediaFrame}>
              {route.params.previewImageUri ? (
                <Image source={{ uri: route.params.previewImageUri }} style={styles.cardImage} />
              ) : (
                <View style={styles.cardImageFallback}>
                  <Text style={styles.cardImageFallbackText}>Your idea</Text>
                </View>
              )}
              <View style={styles.topLeftBadge}>
                <Text style={styles.topLeftBadgeText}>Preview</Text>
              </View>
              <View style={styles.topRightBadge}>
                <Text style={styles.topRightBadgeText}>community</Text>
              </View>
              <View style={styles.titleOverlay}>
                <Text style={styles.title} numberOfLines={3}>Thank you for sharing your idea</Text>
              </View>
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardHook} numberOfLines={2}>{route.params.hook}</Text>
              <Text style={styles.cardDescription} numberOfLines={3}>{route.params.description}</Text>
              <View style={styles.tagRow}>
                <View style={styles.durationPill}>
                  <Text style={styles.durationPillText}>{route.params.durationMin} min</Text>
                </View>
                {(route.params.tags ?? []).slice(0, 3).map((tag) => (
                  <View key={tag} style={styles.tagPill}>
                    <Text style={styles.tagPillText}>{tag}</Text>
                  </View>
                ))}
              </View>
            </View>
          </LinearGradient>
        </Animated.View>

        <Pressable style={styles.homeButton} onPress={() => navigation.popToTop()}>
          <Text style={styles.homeButtonText}>Back to Home</Text>
        </Pressable>
      </View>
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: theme.spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
  },
  cardShell: {
    width: '100%',
    maxWidth: 360,
    alignSelf: 'center',
  },
  cardGlow: {
    borderRadius: 30,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  mediaFrame: {
    aspectRatio: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  cardImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  cardImageFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  cardImageFallbackText: {
    color: theme.colors.accentText,
    fontFamily: theme.fonts.heading,
    fontSize: 18,
  },
  topLeftBadge: {
    position: 'absolute',
    top: 14,
    left: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.94)',
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  topLeftBadgeText: {
    color: theme.colors.textMuted,
    fontFamily: theme.fonts.semibold,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  topRightBadge: {
    position: 'absolute',
    top: 14,
    right: 14,
    borderRadius: 999,
    backgroundColor: '#E88A9A',
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  topRightBadgeText: {
    color: '#FFFFFF',
    fontFamily: theme.fonts.semibold,
    fontSize: 11,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  titleOverlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 18,
  },
  title: {
    fontFamily: theme.fonts.heading,
    fontSize: 24,
    lineHeight: 28,
    color: '#FFFFFF',
    textAlign: 'left',
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  cardBody: {
    backgroundColor: theme.colors.card,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    gap: 8,
  },
  cardHook: {
    fontFamily: theme.fonts.heading,
    fontSize: 20,
    color: theme.colors.text,
  },
  cardDescription: {
    fontFamily: theme.fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.textMuted,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  durationPill: {
    backgroundColor: theme.colors.accent,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  durationPillText: {
    color: theme.colors.accentText,
    fontFamily: theme.fonts.semibold,
    fontSize: 12,
  },
  tagPill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: theme.colors.backgroundAlt,
  },
  tagPillText: {
    color: theme.colors.textMuted,
    fontFamily: theme.fonts.semibold,
    fontSize: 12,
  },
  subtitle: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: -4,
  },
  homeButton: {
    marginTop: theme.spacing.xs,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  homeButtonText: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
    fontSize: 15,
  },
});