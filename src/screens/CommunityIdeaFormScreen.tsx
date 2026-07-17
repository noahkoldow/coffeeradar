import React, { useMemo, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';
import { PrimaryButton } from '../components/PrimaryButton';
import { submitCommunityIdea } from '../services/communityIdeas';
import { useAppState } from '../state/AppState';
import { DeckSuggestion } from '../types';
import { HabitTimeOfDay, SuggestionType } from '../types';
import { atHomeSuggestions } from '../data/atHome';
import { fallbackSuggestions } from '../data/fallback';
import { goOutSuggestions } from '../data/goOut';

type Props = StackScreenProps<RootStackParamList, 'CommunityIdeaForm'>;

const IDEA_TYPES: Array<{ label: string; value: SuggestionType }> = [
  { label: 'At home', value: 'AT_HOME' },
  { label: 'Go out', value: 'GO_OUT' },
  { label: 'Event', value: 'EVENT' },
];

const TYPE_TONES: Record<SuggestionType, { background: string; border: string; text: string; mutedBackground: string }> = {
  AT_HOME: {
    background: '#EAF1FF',
    border: '#C7D8FF',
    text: '#2F5DB8',
    mutedBackground: '#F6F9FF',
  },
  GO_OUT: {
    background: '#E8F7EF',
    border: '#B7DEC8',
    text: '#2E8055',
    mutedBackground: '#F2FBF6',
  },
  EVENT: {
    background: '#FFF1E7',
    border: '#F1D0B9',
    text: '#A05A2D',
    mutedBackground: '#FFF8F3',
  },
};

const tagsForType = (value: SuggestionType): string[] => {
  const source = value === 'AT_HOME'
    ? [...atHomeSuggestions, ...fallbackSuggestions.filter((item) => item.type === 'AT_HOME')]
    : [...goOutSuggestions, ...fallbackSuggestions.filter((item) => item.type !== 'AT_HOME')];

  return Array.from(
    new Set(
      source
        .flatMap((item) => item.tags ?? [])
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));
};

const TIME_OF_DAY_OPTIONS: Array<{ label: string; value: HabitTimeOfDay }> = [
  { label: 'Any time', value: 'any' },
  { label: 'Morning', value: 'morning' },
  { label: 'Afternoon', value: 'afternoon' },
  { label: 'Evening', value: 'evening' },
];

export const CommunityIdeaFormScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { actions } = useAppState();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<SuggestionType>('AT_HOME');
  const [durationMin, setDurationMin] = useState('30');
  const [timeOfDay, setTimeOfDay] = useState<HabitTimeOfDay>('any');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [placeName, setPlaceName] = useState('');
  const [placeAddress, setPlaceAddress] = useState('');
  const [localImageUri, setLocalImageUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const availableTags = useMemo(() => tagsForType(type), [type]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag]));
  };

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission required', 'Please allow photo access to upload your idea image.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.9,
      aspect: [4, 5],
    });

    if (result.canceled || !result.assets.length) return;
    setLocalImageUri(result.assets[0].uri);
  };

  const removeImage = () => setLocalImageUri(null);

  const handleSubmit = async () => {
    const cleanTitle = title.trim();
    const cleanDescription = description.trim();
    const parsedDuration = Number(durationMin);

    if (!cleanTitle || !cleanDescription || !Number.isFinite(parsedDuration) || parsedDuration <= 0) {
      Alert.alert('Missing details', 'Please add a title, description, and a valid duration.');
      return;
    }

    setSubmitting(true);
    try {
      const cleanPlaceName = placeName.trim();
      const cleanPlaceAddress = placeAddress.trim();
      const submissionId = `community_${Date.now()}`;
      const syntheticHook = cleanTitle;
      const ideaSuggestion: DeckSuggestion = {
        id: submissionId,
        type,
        source: 'community',
        title: cleanTitle,
        hook: syntheticHook,
        cta: 'Try it now',
        description: cleanDescription,
        durationMin: parsedDuration,
        timeOfDay,
        tags: selectedTags,
        emojis: [],
        place: cleanPlaceName ? {
          name: cleanPlaceName,
          ...(cleanPlaceAddress ? { address: cleanPlaceAddress } : {}),
        } : undefined,
        confidence: 0.8,
      };
      actions.saveSuggestion({
        id: `saved_${submissionId}`,
        savedAt: new Date().toISOString(),
        source: 'interest_signal',
        suggestion: ideaSuggestion,
      });
      void submitCommunityIdea({
        title: cleanTitle,
        hook: syntheticHook,
        description: cleanDescription,
        type,
        durationMin: parsedDuration,
        timeOfDay,
        tags: selectedTags,
        emojis: [],
        place: cleanPlaceName ? {
          name: cleanPlaceName,
          ...(cleanPlaceAddress ? { address: cleanPlaceAddress } : {}),
        } : undefined,
        localImageUri,
      }).catch((error) => {
        if (error == null) {
          Alert.alert('Submission failed', 'Please sign in and try again.');
          return;
        }
        console.error('Error submitting community idea:', error);
        Alert.alert('Submission failed', error instanceof Error ? error.message : 'Please try again.');
      });

      navigation.replace('CommunityIdeaSuccess', {
        submissionId,
        title: cleanTitle,
        hook: syntheticHook,
        description: cleanDescription,
        durationMin: parsedDuration,
        tags: selectedTags,
        emojis: [],
        previewImageUri: localImageUri,
      });
    } catch (error) {
      Alert.alert('Submission failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + theme.spacing.lg, paddingBottom: insets.bottom + theme.spacing.xl }]}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backLink}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>

          <Text style={styles.title}>Share your idea</Text>
          <Text style={styles.subtitle}>Send a community activity for review. After admin approval, AI polishes wording and fills missing details.</Text>

          <View style={styles.section}>
            <Text style={styles.label}>Type</Text>
            <View style={styles.typeRow}>
              {IDEA_TYPES.map((item) => {
                const selected = type === item.value;
                const tone = TYPE_TONES[item.value];
                return (
                  <Pressable
                    key={item.value}
                    onPress={() => {
                      setType(item.value);
                      setSelectedTags((prev) => prev.filter((tag) => tagsForType(item.value).includes(tag)));
                    }}
                    style={[
                      styles.typeChip,
                      {
                        borderColor: tone.border,
                        backgroundColor: selected ? tone.background : tone.mutedBackground,
                      },
                    ]}
                  >
                    <Text style={[styles.typeChipText, { color: tone.text }]}>{item.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Title</Text>
            <TextInput value={title} onChangeText={setTitle} placeholder="A quick sunset walk" placeholderTextColor={theme.colors.textMuted} style={styles.input} />
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Description</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Short details, vibe, or steps..."
              placeholderTextColor={theme.colors.textMuted}
              style={[styles.input, styles.textArea]}
              multiline
            />
          </View>

          <View style={styles.row}>
            <View style={[styles.section, styles.half]}> 
              <Text style={styles.label}>Duration (min)</Text>
              <TextInput value={durationMin} onChangeText={setDurationMin} keyboardType="numeric" placeholder="30" placeholderTextColor={theme.colors.textMuted} style={styles.input} />
            </View>
            <View style={[styles.section, styles.half]}> 
              <Text style={styles.label}>Best time of day</Text>
              <View style={styles.typeRow}>
                {TIME_OF_DAY_OPTIONS.map((option) => {
                  const selected = timeOfDay === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      onPress={() => setTimeOfDay(option.value)}
                      style={[styles.typeChip, selected && styles.typeChipActive]}
                    >
                      <Text style={[styles.typeChipText, selected && styles.typeChipTextActive]}>{option.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Tags</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tagScrollContent}>
              {availableTags.map((tag) => {
                const selected = selectedTags.includes(tag);
                return (
                  <Pressable
                    key={tag}
                    onPress={() => toggleTag(tag)}
                    style={[styles.tagChip, selected && styles.tagChipActive]}
                  >
                    <Text style={[styles.tagChipText, selected && styles.tagChipTextActive]}>{tag}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {!!selectedTags.length && <Text style={styles.tagsHint}>Selected: {selectedTags.join(', ')}</Text>}
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Place details</Text>
            <TextInput value={placeName} onChangeText={setPlaceName} placeholder="Optional place name" placeholderTextColor={theme.colors.textMuted} style={styles.input} />
            <TextInput value={placeAddress} onChangeText={setPlaceAddress} placeholder="Optional address" placeholderTextColor={theme.colors.textMuted} style={[styles.input, styles.spacedInput]} />
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Photo</Text>
            <Pressable onPress={pickImage} style={styles.imagePicker}>
              {localImageUri ? (
                <View style={styles.imagePreviewWrap}>
                  <Image source={{ uri: localImageUri }} style={styles.imagePreview} />
                  <Pressable onPress={removeImage} style={styles.removeImageButton}>
                    <Text style={styles.removeImageText}>Remove</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.imageEmptyState}>
                  <Text style={styles.imageEmptyIcon}>🖼️</Text>
                  <Text style={styles.imageEmptyTitle}>Upload a photo directly</Text>
                  <Text style={styles.imageEmptyText}>Tap to pick an image from your device</Text>
                </View>
              )}
            </Pressable>
          </View>

          <PrimaryButton label={submitting ? 'Submitting...' : 'Submit idea'} onPress={handleSubmit} disabled={submitting} style={styles.submitButton} />
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  backLink: {
    alignSelf: 'flex-start',
    marginBottom: theme.spacing.sm,
  },
  backText: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
  },
  title: {
    fontFamily: theme.fonts.heading,
    fontSize: 32,
    color: theme.colors.text,
  },
  subtitle: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    lineHeight: 22,
  },
  section: {
    gap: 8,
  },
  label: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
    fontSize: 15,
  },
  input: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.lg,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    color: theme.colors.text,
    fontFamily: theme.fonts.body,
  },
  textArea: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  half: {
    flex: 1,
  },
  typeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  typeChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  typeChipText: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
  },
  tagScrollContent: {
    gap: 8,
    paddingRight: theme.spacing.lg,
  },
  tagChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  tagChipActive: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accent,
  },
  tagChipText: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
    textTransform: 'capitalize',
  },
  tagChipTextActive: {
    color: theme.colors.accentText,
  },
  tagsHint: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  spacedInput: {
    marginTop: 8,
  },
  submitButton: {
    marginTop: theme.spacing.sm,
  },
  imagePicker: {
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
    backgroundColor: theme.colors.card,
  },
  imageEmptyState: {
    minHeight: 170,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
    gap: 8,
  },
  imageEmptyIcon: {
    fontSize: 30,
  },
  imageEmptyTitle: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
    fontSize: 16,
    textAlign: 'center',
  },
  imageEmptyText: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  imagePreviewWrap: {
    position: 'relative',
  },
  imagePreview: {
    width: '100%',
    aspectRatio: 4 / 5,
    resizeMode: 'cover',
  },
  removeImageButton: {
    position: 'absolute',
    right: theme.spacing.md,
    top: theme.spacing.md,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  removeImageText: {
    color: '#fff',
    fontFamily: theme.fonts.semibold,
    fontSize: 12,
  },
});

export default CommunityIdeaFormScreen;