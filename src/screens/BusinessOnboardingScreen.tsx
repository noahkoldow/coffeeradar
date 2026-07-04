import React, { useState, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Animated, Dimensions } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { BusinessHeader } from '../components/BusinessHeader';

interface BusinessOnboardingProps {
  onComplete: () => void;
  onSkip: () => void;
}

const SLIDES = [
  {
    id: 'welcome',
    title: 'Welcome to Bits for Business',
    subtitle: 'Reach engaged users at the perfect moment',
    icon: '🚀',
    description: 'Advertise inside personalized activity recommendations where users are most likely to take action.',
    color: '#4F46E5',
  },
  {
    id: 'intent',
    title: 'Reach Users When Intent Is Highest',
    subtitle: 'Real-time moment matching',
    icon: '⚡',
    description: 'Unlike traditional ads, Bits shows your business only to users actively seeking activities right now.',
    color: '#06B6D4',
  },
  {
    id: 'personalized',
    title: 'Personalized Activity Recommendations',
    subtitle: 'Context-aware placement',
    icon: '🎯',
    description: 'Every user gets a unique deck based on their interests, location, mood, and available time.',
    color: '#8B5CF6',
  },
  {
    id: 'smart',
    title: 'Smart Targeting',
    subtitle: 'Multiple dimensions of precision',
    icon: '🧠',
    description: 'Target by interests, mood, weather, location, time of day, and more. Reach exactly who matters.',
    color: '#EC4899',
  },
  {
    id: 'engagement',
    title: 'Higher Engagement Than Traditional Ads',
    subtitle: 'Intent-driven conversions',
    icon: '📈',
    description: 'Users swipe through Bits to discover activities. Your ads appear naturally in personalized decks.',
    color: '#F59E0B',
  },
  {
    id: 'speed',
    title: 'Launch Campaigns in Minutes',
    subtitle: 'Simple, intuitive creation',
    icon: '⏱️',
    description: 'Create campaigns with our easy form. Upload media, set targeting, and go live after approval.',
    color: '#10B981',
  },
  {
    id: 'analytics',
    title: 'Track Real Performance',
    subtitle: 'Actionable insights',
    icon: '📊',
    description: 'See impressions, engagements, calendar adds, activity starts, and actual conversions.',
    color: '#6366F1',
  },
  {
    id: 'ready',
    title: 'Ready to Get Started?',
    subtitle: 'Create your business account',
    icon: '✨',
    description: "In a few minutes you'll be ready to reach thousands of engaged users.",
    color: '#14B8A6',
  },
];

export const BusinessOnboarding: React.FC<BusinessOnboardingProps> = ({ onComplete, onSkip }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [currentSlide, setCurrentSlide] = useState(0);
  const scrollProgress = useRef(new Animated.Value(0)).current;

  const scrollViewRef = useRef<ScrollView>(null);
  const windowWidth = Dimensions.get('window').width;

  const handleNext = () => {
    if (currentSlide < SLIDES.length - 1) {
      setCurrentSlide(currentSlide + 1);
      scrollViewRef.current?.scrollTo({
        x: (currentSlide + 1) * windowWidth,
        animated: true,
      });
    } else {
      onComplete();
    }
  };

  const handlePrev = () => {
    if (currentSlide > 0) {
      setCurrentSlide(currentSlide - 1);
      scrollViewRef.current?.scrollTo({
        x: (currentSlide - 1) * windowWidth,
        animated: true,
      });
    }
  };

  const handleScroll = Animated.event([{ nativeEvent: { contentOffset: { x: scrollProgress } } }], {
    useNativeDriver: false,
  });

  const onMomentumScrollEnd = (event: any) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(offsetX / windowWidth);
    setCurrentSlide(index);
  };

  const slide = SLIDES[currentSlide];
  const progress = currentSlide / (SLIDES.length - 1);

  return (
    <View style={styles.container}>
      <BusinessHeader showSettingsIcon={false} />
      <Animated.ScrollView
        ref={scrollViewRef}
        horizontal
        pagingEnabled
        scrollEventThrottle={16}
        onScroll={handleScroll}
        onMomentumScrollEnd={onMomentumScrollEnd}
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        style={styles.scrollView}
      >
        {SLIDES.map((s) => (
          <View key={s.id} style={[styles.slide, { width: windowWidth }]}>
            <View style={[styles.slideContent, { backgroundColor: '#FFFFFF' }]}>
              <View style={styles.iconContainer}>
                <Text style={styles.icon}>{s.icon}</Text>
              </View>
              <Text style={styles.title}>{s.title}</Text>
              <Text style={styles.subtitle}>{s.subtitle}</Text>
              <Text style={styles.description}>{s.description}</Text>
            </View>
          </View>
        ))}
      </Animated.ScrollView>

      {/* Progress bar */}
      <View style={styles.progressContainer}>
        <Animated.View
          style={[
            styles.progressBar,
            {
              width: `${progress * 100}%`,
              backgroundColor: slide.color,
            },
          ]}
        />
      </View>

      {/* Slide indicators */}
      <View style={styles.indicatorsContainer}>
        {SLIDES.map((_, idx) => (
          <View
            key={idx}
            style={[
              styles.indicator,
              {
                backgroundColor: idx === currentSlide ? slide.color : theme.colors.border,
              },
            ]}
          />
        ))}
      </View>

      {/* Navigation */}
      <View style={styles.footerContainer}>
        <Pressable
          onPress={onSkip}
          style={[styles.button, styles.skipButton]}
        >
          <Text style={styles.skipButtonText}>Skip</Text>
        </Pressable>

        <View style={styles.navButtons}>
          {currentSlide > 0 && (
            <Pressable onPress={handlePrev} style={[styles.button, styles.prevButton]}>
              <Text style={styles.prevButtonText}>← Back</Text>
            </Pressable>
          )}
          <Pressable
            onPress={handleNext}
            style={[styles.button, styles.nextButton, { backgroundColor: slide.color }]}
          >
            <Text style={styles.nextButtonText}>
              {currentSlide === SLIDES.length - 1 ? 'Get Started' : 'Next →'}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
};

export default BusinessOnboarding;

const createStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    scrollView: {
      flex: 1,
    },
    slide: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: 20,
    },
    slideContent: {
      alignItems: 'center',
      paddingVertical: 40,
      paddingHorizontal: 20,
      borderRadius: 24,
      gap: 16,
    },
    iconContainer: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: theme.colors.card,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 8,
    },
    icon: {
      fontSize: 40,
    },
    title: {
      fontFamily: theme.fonts.heading,
      fontSize: 28,
      color: theme.colors.text,
      textAlign: 'center',
      lineHeight: 36,
    },
    subtitle: {
      fontFamily: theme.fonts.semibold,
      fontSize: 16,
      color: theme.colors.textMuted,
      textAlign: 'center',
    },
    description: {
      fontFamily: theme.fonts.body,
      fontSize: 15,
      color: theme.colors.text,
      textAlign: 'center',
      lineHeight: 22,
    },
    progressContainer: {
      height: 3,
      backgroundColor: theme.colors.border,
      overflow: 'hidden',
    },
    progressBar: {
      height: '100%',
      transition: 'width 0.3s ease',
    },
    indicatorsContainer: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 16,
    },
    indicator: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    footerContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingBottom: 24,
      gap: 12,
    },
    button: {
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 12,
    },
    skipButton: {
      backgroundColor: 'transparent',
    },
    skipButtonText: {
      fontFamily: theme.fonts.semibold,
      fontSize: 14,
      color: theme.colors.textMuted,
    },
    navButtons: {
      flexDirection: 'row',
      gap: 8,
      flex: 1,
    },
    prevButton: {
      flex: 1,
      backgroundColor: theme.colors.backgroundAlt,
      justifyContent: 'center',
      alignItems: 'center',
    },
    prevButtonText: {
      fontFamily: theme.fonts.semibold,
      fontSize: 14,
      color: theme.colors.text,
    },
    nextButton: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    nextButtonText: {
      fontFamily: theme.fonts.semibold,
      fontSize: 14,
      color: '#FFFFFF',
    },
  });
