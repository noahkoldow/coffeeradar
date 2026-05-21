import React, { useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Pressable,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';
import { useAppState } from '../state/AppState';
import { PrimaryButton } from '../components/PrimaryButton';
import { Chip } from '../components/Chip';
import { createCampaign } from '../services/campaigns';
import { Campaign, BusinessCategory } from '../types/business';

type Props = StackScreenProps<RootStackParamList, 'Deck'>;

const BUSINESS_CATEGORIES: BusinessCategory[] = [
  'wellness',
  'food',
  'entertainment',
  'sports',
  'education',
  'tech',
  'retail',
  'services',
  'travel',
  'other',
];

const MOOD_OPTIONS = [
  'relaxed',
  'energetic',
  'social',
  'focused',
  'adventurous',
  'creative',
];

const WEATHER_OPTIONS = ['sunny', 'cloudy', 'rainy', 'snowy', 'hot', 'cold'];

export const CampaignCreationScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { state } = useAppState();

  // Form state
  const [title, setTitle] = useState('');
  const [hook, setHook] = useState('');
  const [description, setDescription] = useState('');
  const [ctaText, setCtaText] = useState('Learn More');
  const [ctaAction, setCtaAction] = useState<'link' | 'call' | 'map'>('link');
  const [ctaValue, setCtaValue] = useState('');
  const [category, setCategory] = useState<BusinessCategory>('wellness');

  // Targeting
  const [selectedMoods, setSelectedMoods] = useState<string[]>([]);
  const [selectedWeather, setSelectedWeather] = useState<string[]>([]);

  // Date range
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  );

  // Budget
  const [budgetAmount, setBudgetAmount] = useState('');
  const [budgetCurrency, setBudgetCurrency] = useState('USD');

  const [submitting, setSubmitting] = useState(false);

  const toggleMood = (mood: string) => {
    setSelectedMoods((prev) =>
      prev.includes(mood) ? prev.filter((m) => m !== mood) : [...prev, mood]
    );
  };

  const toggleWeather = (weather: string) => {
    setSelectedWeather((prev) =>
      prev.includes(weather)
        ? prev.filter((w) => w !== weather)
        : [...prev, weather]
    );
  };

  const validateForm = (): boolean => {
    if (!title.trim()) {
      Alert.alert('Error', 'Please enter a campaign title');
      return false;
    }
    if (!hook.trim()) {
      Alert.alert('Error', 'Please enter a campaign hook');
      return false;
    }
    if (!description.trim()) {
      Alert.alert('Error', 'Please enter a campaign description');
      return false;
    }
    if (!ctaValue.trim()) {
      Alert.alert('Error', 'Please enter a CTA value');
      return false;
    }
    return true;
  };

  const handleCreateCampaign = async () => {
    if (!validateForm()) return;
    if (!state.businessProfile) {
      Alert.alert('Error', 'No business profile found');
      return;
    }

    setSubmitting(true);
    try {
      const campaignData: Partial<Campaign> = {
        title: title.trim(),
        hook: hook.trim(),
        description: description.trim(),
        cta: {
          text: ctaText.trim(),
          action: ctaAction,
          value: ctaValue.trim(),
        },
        category,
        media: [], // TODO: Add media upload
        targeting: {
          interests: [], // TODO: Add interest selection
          moods: selectedMoods,
          locations: [], // TODO: Add location selection
          weather: selectedWeather,
          timeWindows: [], // TODO: Add time window selection
        },
        dateRange: {
          startDate,
          endDate,
        },
        budget: budgetAmount
          ? {
              daily: 0,
              total: parseFloat(budgetAmount),
              currency: budgetCurrency,
            }
          : undefined,
      };

      const campaign = await createCampaign(state.businessProfile.id, campaignData);
      Alert.alert('Success', 'Campaign created as draft');
      navigation.goBack();
    } catch (error) {
      console.error('Error creating campaign:', error);
      Alert.alert('Error', 'Failed to create campaign');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <LinearGradient
      colors={[theme.colors.background, theme.colors.backgroundAlt]}
      style={[styles.container, { paddingTop: insets.top }]}
    >
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()}>
            <Text style={styles.back}>← Back</Text>
          </Pressable>
        </View>

        <Text style={styles.title}>Create Campaign</Text>

        {/* Campaign Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Campaign info</Text>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Title</Text>
            <TextInput
              style={styles.input}
              placeholder="E.g., Summer Yoga Classes"
              placeholderTextColor={theme.colors.textMuted}
              value={title}
              onChangeText={setTitle}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Hook (short tagline)</Text>
            <TextInput
              style={styles.input}
              placeholder="E.g., Find your flow"
              placeholderTextColor={theme.colors.textMuted}
              value={hook}
              onChangeText={setHook}
              maxLength={50}
            />
            <Text style={styles.hint}>{hook.length}/50</Text>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              placeholder="Tell users what makes your offer special"
              placeholderTextColor={theme.colors.textMuted}
              value={description}
              onChangeText={setDescription}
              multiline
              maxLength={200}
            />
            <Text style={styles.hint}>{description.length}/200</Text>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Category</Text>
            <View style={styles.chipsWrap}>
              {BUSINESS_CATEGORIES.map((cat) => (
                <Chip
                  key={cat}
                  label={cat}
                  selected={category === cat}
                  onPress={() => setCategory(cat)}
                />
              ))}
            </View>
          </View>
        </View>

        {/* Call to Action */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Call to action</Text>

          <View style={styles.formGroup}>
            <Text style={styles.label}>CTA Text</Text>
            <TextInput
              style={styles.input}
              placeholder="E.g., Learn More"
              placeholderTextColor={theme.colors.textMuted}
              value={ctaText}
              onChangeText={setCtaText}
              maxLength={30}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>CTA Type</Text>
            <View style={styles.chipsWrap}>
              {(['link', 'call', 'map'] as const).map((type) => (
                <Chip
                  key={type}
                  label={type}
                  selected={ctaAction === type}
                  onPress={() => setCtaAction(type)}
                />
              ))}
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>
              {ctaAction === 'link'
                ? 'URL'
                : ctaAction === 'call'
                  ? 'Phone number'
                  : 'Address'}
            </Text>
            <TextInput
              style={styles.input}
              placeholder={
                ctaAction === 'link'
                  ? 'https://example.com'
                  : ctaAction === 'call'
                    ? '+1234567890'
                    : '123 Main St'
              }
              placeholderTextColor={theme.colors.textMuted}
              value={ctaValue}
              onChangeText={setCtaValue}
            />
          </View>
        </View>

        {/* Targeting */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Targeting (optional)</Text>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Preferred moods</Text>
            <View style={styles.chipsWrap}>
              {MOOD_OPTIONS.map((mood) => (
                <Chip
                  key={mood}
                  label={mood}
                  selected={selectedMoods.includes(mood)}
                  onPress={() => toggleMood(mood)}
                />
              ))}
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Weather conditions</Text>
            <View style={styles.chipsWrap}>
              {WEATHER_OPTIONS.map((weather) => (
                <Chip
                  key={weather}
                  label={weather}
                  selected={selectedWeather.includes(weather)}
                  onPress={() => toggleWeather(weather)}
                />
              ))}
            </View>
          </View>
        </View>

        {/* Date & Budget */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Campaign period & budget</Text>

          <View style={styles.row}>
            <View style={[styles.formGroup, styles.halfWidth]}>
              <Text style={styles.label}>Start date</Text>
              <TextInput
                style={styles.input}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={theme.colors.textMuted}
                value={startDate}
                onChangeText={setStartDate}
              />
            </View>
            <View style={[styles.formGroup, styles.halfWidth]}>
              <Text style={styles.label}>End date</Text>
              <TextInput
                style={styles.input}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={theme.colors.textMuted}
                value={endDate}
                onChangeText={setEndDate}
              />
            </View>
          </View>

          <View style={styles.row}>
            <View style={[styles.formGroup, styles.halfWidth]}>
              <Text style={styles.label}>Budget</Text>
              <TextInput
                style={styles.input}
                placeholder="0.00"
                placeholderTextColor={theme.colors.textMuted}
                value={budgetAmount}
                onChangeText={setBudgetAmount}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={[styles.formGroup, styles.halfWidth]}>
              <Text style={styles.label}>Currency</Text>
              <TextInput
                style={styles.input}
                placeholder="USD"
                placeholderTextColor={theme.colors.textMuted}
                value={budgetCurrency}
                onChangeText={setBudgetCurrency}
                maxLength={3}
              />
            </View>
          </View>
        </View>

        {/* Info Banner */}
        <View style={styles.infoBanner}>
          <Text style={styles.infoText}>
            💡 Your campaign will be saved as a draft. You can edit it anytime before submitting for approval.
          </Text>
        </View>
      </ScrollView>

      {/* Create Button */}
      <View style={styles.footer}>
        <PrimaryButton
          label={submitting ? 'Creating...' : 'Save as Draft'}
          onPress={handleCreateCampaign}
          disabled={submitting}
        />
      </View>
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    scroll: {
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.lg,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: theme.spacing.lg,
    },
    back: {
      fontFamily: theme.fonts.semibold,
      color: theme.colors.textMuted,
    },
    title: {
      fontFamily: theme.fonts.heading,
      fontSize: 28,
      color: theme.colors.text,
      marginBottom: theme.spacing.lg,
    },
    section: {
      backgroundColor: theme.colors.card,
      borderRadius: theme.radius.md,
      padding: theme.spacing.lg,
      marginBottom: theme.spacing.lg,
    },
    sectionTitle: {
      fontFamily: theme.fonts.semibold,
      fontSize: 16,
      color: theme.colors.text,
      marginBottom: theme.spacing.md,
    },
    formGroup: {
      marginBottom: theme.spacing.md,
    },
    label: {
      fontFamily: theme.fonts.semibold,
      fontSize: 13,
      color: theme.colors.text,
      marginBottom: theme.spacing.xs,
    },
    input: {
      backgroundColor: theme.colors.backgroundAlt,
      borderRadius: theme.radius.sm,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 12,
      fontFamily: theme.fonts.body,
      color: theme.colors.text,
    },
    multiline: {
      minHeight: 88,
      textAlignVertical: 'top',
    },
    hint: {
      fontFamily: theme.fonts.body,
      fontSize: 11,
      color: theme.colors.textMuted,
      marginTop: theme.spacing.xs,
    },
    row: {
      flexDirection: 'row',
      gap: theme.spacing.md,
      marginBottom: theme.spacing.md,
    },
    halfWidth: {
      flex: 1,
      marginBottom: 0,
    },
    chipsWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
    },
    infoBanner: {
      backgroundColor: theme.colors.card,
      borderLeftWidth: 4,
      borderLeftColor: theme.colors.accent,
      borderRadius: theme.radius.md,
      padding: theme.spacing.md,
      marginBottom: theme.spacing.lg,
    },
    infoText: {
      fontFamily: theme.fonts.body,
      fontSize: 13,
      color: theme.colors.text,
      lineHeight: 18,
    },
    footer: {
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.lg,
      backgroundColor: theme.colors.background,
    },
  });
