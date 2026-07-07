import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Dimensions,
  PanResponder,
} from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import * as ImagePicker from 'expo-image-picker';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';
import { useAppState } from '../state/AppState';
import { createCampaign, updateCampaign, getCampaign } from '../services/business';
import { Campaign, BusinessCategory, CampaignMedia } from '../types/business';
import { DeckSuggestion } from '../types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SuggestionCard } from '../components/SuggestionCard';

type Props = StackScreenProps<RootStackParamList, 'BusinessCampaignForm'>;

const BUSINESS_CATEGORIES: { label: string; value: BusinessCategory }[] = [
  { label: '🍔 Restaurant', value: 'restaurant' },
  { label: '☕ Café', value: 'cafe' },
  { label: '💪 Gym', value: 'gym' },
  { label: '🧘 Wellness', value: 'wellness' },
  { label: '🎬 Entertainment', value: 'entertainment' },
  { label: '🛍️ Retail', value: 'retail' },
  { label: '🔧 Services', value: 'services' },
  { label: '🎉 Events', value: 'events' },
  { label: '✈️ Tourism', value: 'tourism' },
  { label: '⭐ Other', value: 'other' },
];

const CTA_ACTIONS = [
  { label: 'Visit Website', value: 'url' },
  { label: 'Call Now', value: 'phone' },
  { label: 'Add to Calendar', value: 'calendar' },
  { label: 'Visit location', value: 'location' },
];

const TARGET_TAG_OPTIONS: { id: string; label: string }[] = [
  { id: 'fitness', label: '🏋️ Fitness' },
  { id: 'cycling', label: '🚴 Cycling' },
  { id: 'running', label: '🏃 Running' },
  { id: 'swimming', label: '🏊 Swimming' },
  { id: 'hiking', label: '🥾 Hiking' },
  { id: 'wellness', label: '🧘 Wellness' },
  { id: 'nature', label: '🌿 Nature' },
  { id: 'beaches', label: '🏖️ Beaches' },
  { id: 'parks', label: '🌳 Parks' },
  { id: 'explore', label: '🧭 Explore' },
  { id: 'coffee', label: '☕ Coffee' },
  { id: 'food', label: '🍽️ Food' },
  { id: 'street_food', label: '🌮 Street Food' },
  { id: 'art', label: '🎨 Art' },
  { id: 'music', label: '🎵 Music' },
  { id: 'movies', label: '🎬 Movies' },
  { id: 'learning', label: '📚 Learning' },
  { id: 'focus', label: '🎯 Focus' },
  { id: 'social', label: '🫢 Social' },
];

const CARD_ASPECT: [number, number] = [16, 9];
const CROP_REQUIREMENTS = {
  label: '16:9 landscape',
  recommended: '1920 × 1080 px',
  description: 'Card header crop for the standard campaign card.',
};

const DEFAULT_CATEGORY_EMOJIS: Record<BusinessCategory, string[]> = {
  restaurant: ['🍽️', '🔥', '🥂'],
  cafe: ['☕', '🥐', '✨'],
  gym: ['💪', '⚡', '🏋️'],
  wellness: ['🧘', '🌿', '💆'],
  entertainment: ['🎬', '🎟️', '🎉'],
  retail: ['🛍️', '💎', '🛒'],
  services: ['🔧', '✅', '⚙️'],
  events: ['🎉', '📅', '🎈'],
  tourism: ['✈️', '📍', '🌍'],
  other: ['⭐', '💡', '🚀'],
};

const getDefaultCategoryEmojis = (category?: BusinessCategory): string[] => {
  const fallback: BusinessCategory = 'cafe';
  return DEFAULT_CATEGORY_EMOJIS[category ?? fallback] ?? DEFAULT_CATEGORY_EMOJIS[fallback];
};

export const BusinessCampaignFormScreen: React.FC<Props> = ({ navigation, route }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { state } = useAppState();
  const [loading, setLoading] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [emojiEditorVisible, setEmojiEditorVisible] = useState(false);
  const [emojiDraft, setEmojiDraft] = useState('');
  const businessId = state.userId ?? state.businessProfile?.ownerId ?? state.businessProfile?.id;
  const businessLogoUrl = state.businessProfile?.logo?.url;
  const selectedAspect = CARD_ASPECT;
  const selectedAspectRatio = '16:9';
  const selectedCrop = CROP_REQUIREMENTS;

  const campaignId = route.params?.campaignId;
  const [campaign, setCampaign] = useState<Partial<Campaign>>({
    title: '',
    hook: '',
    description: '',
    category: 'cafe',
    cta: { text: 'Learn More', action: 'url', value: '' },
    emojis: getDefaultCategoryEmojis('cafe'),
    targeting: {},
  });
  const [imgNaturalSize, setImgNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [previewLayout, setPreviewLayout] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const panResponderRef = useRef<any>(null);
  const panStateRef = useRef<{ startFocalX: number; startFocalY: number; sw: number; sh: number } | null>(null);
  const [campaignLogoUploading, setCampaignLogoUploading] = useState(false);
  const effectiveLogoUrl = campaign.logoUrl || businessLogoUrl;
  const targeting = campaign.targeting ?? {};

  const updateTargeting = (updates: Partial<NonNullable<Campaign['targeting']>>) => {
    setCampaign((prev) => ({
      ...prev,
      targeting: {
        ...(prev.targeting ?? {}),
        ...updates,
      },
    }));
  };

  const toggleRequiredTag = (tag: string) => {
    const selected = targeting.requiredTags ?? [];
    const next = selected.includes(tag)
      ? selected.filter((item) => item !== tag)
      : [...selected, tag];
    updateTargeting({ requiredTags: next, interests: next });
  };

  const oneTimeDate = targeting.oneTimeStartAt
    ? targeting.oneTimeStartAt.slice(0, 10)
    : '';
  const oneTimeTime = targeting.oneTimeStartAt && targeting.oneTimeStartAt.length >= 16
    ? targeting.oneTimeStartAt.slice(11, 16)
    : '';

  const setOneTimeDateTime = (dateValue: string, timeValue: string) => {
    const cleanDate = dateValue.trim();
    const cleanTime = timeValue.trim();
    if (!cleanDate || !cleanTime) {
      updateTargeting({ oneTimeStartAt: undefined });
      return;
    }
    const parsed = new Date(`${cleanDate}T${cleanTime}:00`);
    if (Number.isNaN(parsed.getTime())) {
      updateTargeting({ oneTimeStartAt: undefined });
      return;
    }
    updateTargeting({ oneTimeStartAt: parsed.toISOString() });
  };

  useEffect(() => {
    if (campaignId && businessId) {
      loadCampaign();
    }
  }, [campaignId, businessId]);

  useEffect(() => {
    const uri = campaign?.media?.[0]?.url;
    if (!uri) return;
    Image.getSize(
      uri,
      (w, h) => setImgNaturalSize({ width: w, height: h }),
      () => {}
    );
  }, [campaign?.media?.[0]?.url]);

  // set up pan responder for drag-to-pan
  useEffect(() => {
    panResponderRef.current = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        const media = campaign?.media?.[0];
        if (!media || !imgNaturalSize || previewLayout.width === 0) {
          panStateRef.current = null;
          return;
        }
        const iw = imgNaturalSize.width;
        const ih = imgNaturalSize.height;
        const cw = previewLayout.width;
        const ch = previewLayout.height;
        const scale = Math.max(cw / iw, ch / ih);
        const sw = iw * scale;
        const sh = ih * scale;
        panStateRef.current = { startFocalX: media.focalX ?? 0.5, startFocalY: media.focalY ?? 0.5, sw, sh };
      },
      onPanResponderMove: (_, gesture) => {
        const st = panStateRef.current;
        if (!st) return;
        const dx = gesture.dx;
        const dy = gesture.dy;
        const deltaX = -dx / st.sw; // dragging right => show left part => decrease focalX
        const deltaY = -dy / st.sh;
        const newFocalX = Math.max(0, Math.min(1, st.startFocalX + deltaX));
        const newFocalY = Math.max(0, Math.min(1, st.startFocalY + deltaY));
        setCampaign((prev) => ({
          ...prev,
          media: (prev.media ?? []).map((it, i) => (i === 0 ? { ...it, focalX: newFocalX, focalY: newFocalY } : it)),
        }));
      },
      onPanResponderRelease: () => {
        panStateRef.current = null;
      },
    });
  }, [campaign?.media, imgNaturalSize, previewLayout]);

  const loadCampaign = async () => {
    if (!campaignId || !businessId) return;
    setLoading(true);
    try {
      const loaded = await getCampaign(businessId, campaignId);
      if (loaded) {
        setCampaign({
          ...loaded,
          emojis: loaded.emojis && loaded.emojis.length > 0 ? loaded.emojis : getDefaultCategoryEmojis(loaded.category),
        });
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to load campaign');
    } finally {
      setLoading(false);
    }
  };

  const parseEmojiDraft = (value: string): string[] => value.split(/\s+/).filter(Boolean).slice(0, 6);

  const openEmojiEditor = () => {
    setEmojiDraft((campaign.emojis ?? []).join(' '));
    setEmojiEditorVisible(true);
  };

  const saveEmojiEditor = () => {
    const parsed = parseEmojiDraft(emojiDraft);
    setCampaign((prev) => ({
      ...prev,
      emojis: parsed.length > 0 ? parsed : getDefaultCategoryEmojis(prev.category),
    }));
    setEmojiEditorVisible(false);
  };

  const handleAddImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission required', 'Please allow photo access to upload campaign images.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
      allowsEditing: true,
      aspect: selectedAspect,
    });

    if (result.canceled || !result.assets.length) return;

    const asset = result.assets[0];
    const image: CampaignMedia = {
      id: `local_${Date.now()}`,
      url: asset.uri,
      type: 'image',
      aspectRatio: selectedAspectRatio,
      focalX: 0.5,
      focalY: 0.5,
      uploadedAt: new Date().toISOString(),
      validated: true,
    };

    setCampaign((prev) => ({
      ...prev,
      media: [image, ...(prev.media ?? []).slice(1)],
    }));
  };

  const handleAddLogo = async () => {
    setCampaignLogoUploading(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission required', 'Please allow photo access to upload a campaign logo.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      if (result.canceled || !result.assets.length) return;
      setCampaign((prev) => ({ ...prev, logoUrl: result.assets[0].uri }));
    } catch (error) {
      console.error(error);
    } finally {
      setCampaignLogoUploading(false);
    }
  };

  const removeImage = (id: string) => {
    setCampaign((prev) => ({
      ...prev,
      media: (prev.media ?? []).filter((item) => item.id !== id),
    }));
  };

  const handleSave = async () => {
    if (!campaign.title?.trim()) {
      Alert.alert('Validation Error', 'Campaign title is required');
      return;
    }
    if (!campaign.hook?.trim()) {
      Alert.alert('Validation Error', 'Campaign hook is required');
      return;
    }
    if (!campaign.cta?.value?.trim()) {
      Alert.alert('Validation Error', 'CTA value is required');
      return;
    }
    if (!targeting.requiredTags?.length) {
      Alert.alert('Validation Error', 'Please select at least one required audience tag');
      return;
    }
    if (targeting.requiredDurationMin && targeting.requiredDurationMin < 1) {
      Alert.alert('Validation Error', 'Duration must be at least 1 minute');
      return;
    }
    if (targeting.isOneTimeEvent) {
      if (!targeting.oneTimeStartAt) {
        Alert.alert('Validation Error', 'Please provide date and time for the one-time event');
        return;
      }
      const oneTimeDateValue = new Date(targeting.oneTimeStartAt);
      if (Number.isNaN(oneTimeDateValue.getTime())) {
        Alert.alert('Validation Error', 'One-time event date/time is invalid');
        return;
      }
    }
    if (targeting.targetLocation) {
      const { lat, lng, radiusKm } = targeting.targetLocation;
      if (
        typeof lat !== 'number' ||
        typeof lng !== 'number' ||
        Number.isNaN(lat) ||
        Number.isNaN(lng) ||
        typeof radiusKm !== 'number' ||
        Number.isNaN(radiusKm) ||
        radiusKm <= 0
      ) {
        Alert.alert('Validation Error', 'Target location requires valid latitude, longitude, and radius');
        return;
      }
    }
    if (campaign.retrieveOffer && !campaign.retrieveOffer.value.trim()) {
      Alert.alert('Validation Error', 'Retrieve Offer value is required when the option is enabled');
      return;
    }

    if (!businessId) {
      Alert.alert('Error', 'No business profile found');
      return;
    }

    setLoading(true);
    try {
      if (campaignId) {
        await updateCampaign(businessId, campaignId, campaign);
        Alert.alert('Success', 'Campaign updated successfully');
      } else {
        await createCampaign(businessId, campaign);
        Alert.alert('Success', 'Campaign created successfully');
      }
      navigation.goBack();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save campaign';
      Alert.alert('Error', message);
    } finally {
      setLoading(false);
    }
  };

  const campaignEmojis = campaign.emojis && campaign.emojis.length > 0
    ? campaign.emojis
    : getDefaultCategoryEmojis(campaign.category);

  const previewSuggestion: DeckSuggestion = {
    id: `campaign_preview_${campaignId ?? 'new'}`,
    type: 'GO_OUT',
    source: 'business',
    title: campaign.title?.trim() || 'Untitled Campaign',
    hook: campaign.hook?.trim() || 'Promoted',
    cta: campaign.cta?.text?.trim() || 'Learn More',
    description: campaign.description?.trim() || 'Describe your offer so users understand the value quickly.',
    durationMin: campaign.targeting?.requiredDurationMin ?? 60,
    tags: campaign.targeting?.requiredTags?.length
      ? campaign.targeting.requiredTags
      : campaign.targeting?.interests ?? [],
    emojis: campaignEmojis,
    place: campaign.targeting?.targetLocation
      ? {
          name: campaign.targeting.targetLocation.name || campaign.targeting.locationName || 'Target location',
          lat: campaign.targeting.targetLocation.lat,
          lng: campaign.targeting.targetLocation.lng,
          address: campaign.targeting.locationName || campaign.cta?.value || undefined,
        }
      : undefined,
    confidence: 0.78,
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{campaignId ? 'Edit Campaign' : 'Create Campaign'}</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.contentContainer}>
        {/* Campaign Basics */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Campaign Details</Text>
          <View style={styles.formGroup}>
            <Text style={styles.label}>Slide Builder</Text>
            <Text style={styles.mediaHint}>
              Card header format only. Hero media is cropped to 16:9 and shown in a standard-height card.
            </Text>
            <View style={styles.cropRequirementBox}>
              <Text style={styles.cropRequirementTitle}>Card header crop: {selectedCrop.label}</Text>
              <Text style={styles.cropRequirementText}>
                Picker crop: {selectedCrop.label}. Recommended image size: {selectedCrop.recommended}. {selectedCrop.description}
              </Text>
            </View>

            <View style={styles.builderStandardCard}>
              <View
                style={styles.builderCardMediaArea}
                onLayout={(e) => {
                  const { width, height } = e.nativeEvent.layout;
                  setPreviewLayout({ width, height });
                }}
              >
                {campaign.media?.length && campaign.media[0].url ? (
                  <>
                    {campaign.media[0].url && (
                      <Image
                        source={{ uri: campaign.media[0].url }}
                        onLoad={({ nativeEvent }) => {
                          const { width, height } = nativeEvent.source;
                          if (width && height) setImgNaturalSize({ width, height });
                        }}
                        style={{ width: 0, height: 0 }}
                      />
                    )}
                    <View style={styles.builderMediaLayer} {...(panResponderRef.current?.panHandlers ?? {})}>
                      {(() => {
                        const media = campaign.media?.[0];
                        if (!media) return null;
                        const focalX = media.focalX ?? 0.5;
                        const focalY = media.focalY ?? 0.5;

                        if (!imgNaturalSize || previewLayout.width === 0) {
                          return <Image source={{ uri: media.url }} style={styles.primaryMediaPreview} />;
                        }

                        const iw = imgNaturalSize.width;
                        const ih = imgNaturalSize.height;
                        const cw = previewLayout.width;
                        const ch = previewLayout.height;
                        const scale = Math.max(cw / iw, ch / ih);
                        const sw = iw * scale;
                        const sh = ih * scale;

                        const desiredCenterX = focalX * sw;
                        const desiredCenterY = focalY * sh;
                        let translateX = Math.round(cw / 2 - desiredCenterX);
                        let translateY = Math.round(ch / 2 - desiredCenterY);

                        const maxOffsetX = Math.max(0, sw - cw);
                        const maxOffsetY = Math.max(0, sh - ch);
                        translateX = Math.max(-maxOffsetX, Math.min(0, translateX));
                        translateY = Math.max(-maxOffsetY, Math.min(0, translateY));

                        return (
                          <Image
                            source={{ uri: media.url }}
                            style={{
                              position: 'absolute',
                              width: sw,
                              height: sh,
                              left: translateX,
                              top: translateY,
                            }}
                          />
                        );
                      })()}
                    </View>
                    <Pressable onPress={handleAddImage} style={styles.builderMediaEditPill}>
                      <Text style={styles.builderMediaEditText}>Change media ({selectedAspectRatio})</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable onPress={handleAddImage} style={styles.builderMediaPlaceholder}>
                    <Text style={styles.builderPlus}>+</Text>
                    <Text style={styles.builderPlaceholderTitle}>Add hero media</Text>
                    <Text style={styles.builderPlaceholderText}>Required crop: {selectedCrop.label}</Text>
                    <Text style={styles.builderPlaceholderText}>Recommended: {selectedCrop.recommended}</Text>
                  </Pressable>
                )}

                <View style={styles.previewTopRow} pointerEvents="box-none">
                  <View style={styles.previewBadgeWrap}>
                    <Text style={styles.previewBadge}>Ad</Text>
                  </View>
                  {effectiveLogoUrl ? (
                    <Pressable onPress={handleAddLogo} style={styles.previewLogoWrap}>
                      <Image source={{ uri: effectiveLogoUrl }} style={styles.previewLogo} />
                    </Pressable>
                  ) : (
                    <Pressable onPress={handleAddLogo} style={styles.builderLogoPlaceholder}>
                      <Text style={styles.builderLogoPlus}>+</Text>
                    </Pressable>
                  )}
                </View>
              </View>

              <View style={styles.builderCardBody}>
                <View style={styles.builderEmojiRow}>
                  <Text style={styles.builderCrown}>👑</Text>
                  <Text style={styles.builderEmojiText}>{campaignEmojis.join(' ')}</Text>
                  <Pressable onPress={openEmojiEditor} style={styles.builderEmojiEditButton}>
                    <Text style={styles.builderEmojiEditText}>Edit</Text>
                  </Pressable>
                </View>

                <TextInput
                  style={styles.builderHookInputCard}
                  placeholder="+ Add short hook"
                  placeholderTextColor={theme.colors.textMuted}
                  value={campaign.hook || ''}
                  onChangeText={(text) => setCampaign({ ...campaign, hook: text })}
                  editable={!loading}
                  maxLength={80}
                />
                <TextInput
                  style={styles.builderTitleInputCard}
                  placeholder="+ Add headline"
                  placeholderTextColor={theme.colors.textMuted}
                  value={campaign.title || ''}
                  onChangeText={(text) => setCampaign({ ...campaign, title: text })}
                  editable={!loading}
                  maxLength={80}
                  multiline
                />
                <TextInput
                  style={styles.builderDescriptionInputCard}
                  placeholder="+ Add offer details"
                  placeholderTextColor={theme.colors.textMuted}
                  value={campaign.description || ''}
                  onChangeText={(text) => setCampaign({ ...campaign, description: text })}
                  editable={!loading}
                  maxLength={180}
                  multiline
                />
                <TextInput
                  style={styles.builderCtaInputCard}
                  placeholder="+ CTA"
                  placeholderTextColor="#fff"
                  value={campaign.cta?.text || ''}
                  onChangeText={(text) => setCampaign({ ...campaign, cta: { ...campaign.cta!, text } })}
                  editable={!loading}
                  maxLength={28}
                />
              </View>
            </View>

            <View style={styles.mediaActions}>
              <Pressable onPress={handleAddImage} style={styles.mediaButton}>
                <Text style={styles.mediaButtonText}>+ Hero media ({selectedAspectRatio})</Text>
              </Pressable>
              <Pressable
                onPress={handleAddLogo}
                style={[styles.mediaButton, { marginLeft: 8 }]}
              >
                <Text style={styles.mediaButtonText}>{campaignLogoUploading ? 'Opening...' : '+ Logo (1:1)'}</Text>
              </Pressable>
            </View>

            {!!campaign.media?.length && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mediaStrip}>
                {campaign.media.map((item) => (
                  <View key={item.id} style={styles.mediaThumbWrap}>
                    <Image source={{ uri: item.url }} style={styles.mediaThumb} />
                    <Pressable onPress={() => removeImage(item.id)} style={styles.mediaRemoveBtn}>
                      <Text style={styles.mediaRemoveText}>×</Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
              {BUSINESS_CATEGORIES.map((cat) => (
                <Pressable
                  key={cat.value}
                  onPress={() =>
                    setCampaign({
                      ...campaign,
                      category: cat.value,
                      emojis: getDefaultCategoryEmojis(cat.value),
                    })
                  }
                  style={[
                    styles.categoryButton,
                    campaign.category === cat.value && styles.categoryButtonActive,
                  ]}
                >
                  <Text style={styles.categoryButtonText}>{cat.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>

        {/* Call to Action */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Call to Action</Text>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Action Type</Text>
            {CTA_ACTIONS.map((action) => (
              <Pressable
                key={action.value}
                onPress={() =>
                  setCampaign({
                    ...campaign,
                    cta: { ...campaign.cta!, action: action.value as any },
                  })
                }
                style={[
                  styles.optionButton,
                  campaign.cta?.action === action.value && styles.optionButtonActive,
                ]}
              >
                <Text
                  style={[
                    styles.optionText,
                    campaign.cta?.action === action.value && styles.optionTextActive,
                  ]}
                >
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>
              {campaign.cta?.action === 'url'
                ? 'Website URL'
                : campaign.cta?.action === 'phone'
                ? 'Phone Number'
                : campaign.cta?.action === 'location'
                ? 'Location Address'
                : 'Calendar Details'}
              *
            </Text>
            <TextInput
              style={styles.input}
              placeholder={
                campaign.cta?.action === 'url'
                  ? 'https://...'
                  : campaign.cta?.action === 'phone'
                  ? '+1 (555) 123-4567'
                  : campaign.cta?.action === 'location'
                  ? 'Alexanderplatz 1, Berlin'
                  : 'Value'
              }
              value={campaign.cta?.value || ''}
              onChangeText={(text) =>
                setCampaign({
                  ...campaign,
                  cta: { ...campaign.cta!, value: text },
                })
              }
              editable={!loading}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Button Text</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., Book Now"
              value={campaign.cta?.text || ''}
              onChangeText={(text) =>
                setCampaign({
                  ...campaign,
                  cta: { ...campaign.cta!, text },
                })
              }
              editable={!loading}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Retrieve Offer</Text>
            <View style={styles.retrieveRow}>
              <Pressable
                onPress={() => setCampaign({ ...campaign, retrieveOffer: undefined })}
                style={[
                  styles.retrieveChip,
                  !campaign.retrieveOffer && styles.retrieveChipActive,
                ]}
              >
                <Text style={[styles.retrieveChipText, !campaign.retrieveOffer && styles.retrieveChipTextActive]}>Disabled</Text>
              </Pressable>
              <Pressable
                onPress={() =>
                  setCampaign({
                    ...campaign,
                    retrieveOffer: { type: 'qr', value: campaign.retrieveOffer?.type === 'qr' ? campaign.retrieveOffer.value : '' },
                  })
                }
                style={[
                  styles.retrieveChip,
                  campaign.retrieveOffer?.type === 'qr' && styles.retrieveChipActive,
                ]}
              >
                <Text style={[styles.retrieveChipText, campaign.retrieveOffer?.type === 'qr' && styles.retrieveChipTextActive]}>QR value</Text>
              </Pressable>
              <Pressable
                onPress={() =>
                  setCampaign({
                    ...campaign,
                    retrieveOffer: { type: 'code', value: campaign.retrieveOffer?.type === 'code' ? campaign.retrieveOffer.value : '' },
                  })
                }
                style={[
                  styles.retrieveChip,
                  campaign.retrieveOffer?.type === 'code' && styles.retrieveChipActive,
                ]}
              >
                <Text style={[styles.retrieveChipText, campaign.retrieveOffer?.type === 'code' && styles.retrieveChipTextActive]}>Text code</Text>
              </Pressable>
            </View>

            {campaign.retrieveOffer ? (
              <TextInput
                style={styles.input}
                placeholder={campaign.retrieveOffer.type === 'qr' ? 'https://offer.example/redeem?id=...' : 'SUMMER25'}
                value={campaign.retrieveOffer.value}
                onChangeText={(text) =>
                  setCampaign({
                    ...campaign,
                    retrieveOffer: { ...campaign.retrieveOffer!, value: text },
                  })
                }
                editable={!loading}
              />
            ) : null}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Audience Targeting</Text>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Required User Tags *</Text>
            <Text style={styles.mediaHint}>Users must match all selected tags to see this campaign.</Text>
            <View style={styles.retrieveRow}>
              {TARGET_TAG_OPTIONS.map((tag) => {
                const isActive = (targeting.requiredTags ?? []).includes(tag.id);
                return (
                  <Pressable
                    key={tag.id}
                    onPress={() => toggleRequiredTag(tag.id)}
                    style={[styles.retrieveChip, isActive && styles.retrieveChipActive]}
                  >
                    <Text style={[styles.retrieveChipText, isActive && styles.retrieveChipTextActive]}>{tag.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>One-Time Event</Text>
            <View style={styles.retrieveRow}>
              <Pressable
                onPress={() => updateTargeting({ isOneTimeEvent: false, oneTimeStartAt: undefined })}
                style={[styles.retrieveChip, !targeting.isOneTimeEvent && styles.retrieveChipActive]}
              >
                <Text style={[styles.retrieveChipText, !targeting.isOneTimeEvent && styles.retrieveChipTextActive]}>No</Text>
              </Pressable>
              <Pressable
                onPress={() => updateTargeting({ isOneTimeEvent: true })}
                style={[styles.retrieveChip, !!targeting.isOneTimeEvent && styles.retrieveChipActive]}
              >
                <Text style={[styles.retrieveChipText, !!targeting.isOneTimeEvent && styles.retrieveChipTextActive]}>Yes</Text>
              </Pressable>
            </View>

            {targeting.isOneTimeEvent ? (
              <>
                <Text style={styles.mediaHint}>Set local event date and time.</Text>
                <View style={styles.rowInputs}>
                  <TextInput
                    style={[styles.input, styles.halfInput]}
                    placeholder="YYYY-MM-DD"
                    value={oneTimeDate}
                    onChangeText={(text) => setOneTimeDateTime(text, oneTimeTime)}
                    editable={!loading}
                  />
                  <TextInput
                    style={[styles.input, styles.halfInput]}
                    placeholder="HH:mm"
                    value={oneTimeTime}
                    onChangeText={(text) => setOneTimeDateTime(oneTimeDate, text)}
                    editable={!loading}
                  />
                </View>
              </>
            ) : null}
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Required Free Time (minutes)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., 60"
              keyboardType="numeric"
              value={targeting.requiredDurationMin ? String(targeting.requiredDurationMin) : ''}
              onChangeText={(text) => {
                const trimmed = text.trim();
                if (!trimmed) {
                  updateTargeting({ requiredDurationMin: undefined });
                  return;
                }
                const parsed = Number.parseInt(trimmed, 10);
                updateTargeting({ requiredDurationMin: Number.isNaN(parsed) ? undefined : parsed });
              }}
              editable={!loading}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Target Location</Text>
            <Text style={styles.mediaHint}>Only users inside this radius qualify.</Text>
            <TextInput
              style={styles.input}
              placeholder="Location name (optional)"
              value={targeting.targetLocation?.name ?? targeting.locationName ?? ''}
              onChangeText={(text) =>
                updateTargeting({
                  locationName: text,
                  targetLocation: {
                    lat: targeting.targetLocation?.lat ?? 0,
                    lng: targeting.targetLocation?.lng ?? 0,
                    radiusKm: targeting.targetLocation?.radiusKm ?? 2,
                    name: text,
                  },
                })
              }
              editable={!loading}
            />
            <View style={styles.rowInputs}>
              <TextInput
                style={[styles.input, styles.thirdInput]}
                placeholder="Latitude"
                keyboardType="decimal-pad"
                value={targeting.targetLocation?.lat !== undefined ? String(targeting.targetLocation?.lat) : ''}
                onChangeText={(text) => {
                  const parsed = Number.parseFloat(text);
                  updateTargeting({
                    targetLocation: {
                      name: targeting.targetLocation?.name ?? targeting.locationName,
                      lat: Number.isNaN(parsed) ? 0 : parsed,
                      lng: targeting.targetLocation?.lng ?? 0,
                      radiusKm: targeting.targetLocation?.radiusKm ?? 2,
                    },
                  });
                }}
                editable={!loading}
              />
              <TextInput
                style={[styles.input, styles.thirdInput]}
                placeholder="Longitude"
                keyboardType="decimal-pad"
                value={targeting.targetLocation?.lng !== undefined ? String(targeting.targetLocation?.lng) : ''}
                onChangeText={(text) => {
                  const parsed = Number.parseFloat(text);
                  updateTargeting({
                    targetLocation: {
                      name: targeting.targetLocation?.name ?? targeting.locationName,
                      lat: targeting.targetLocation?.lat ?? 0,
                      lng: Number.isNaN(parsed) ? 0 : parsed,
                      radiusKm: targeting.targetLocation?.radiusKm ?? 2,
                    },
                  });
                }}
                editable={!loading}
              />
              <TextInput
                style={[styles.input, styles.thirdInput]}
                placeholder="Radius km"
                keyboardType="decimal-pad"
                value={targeting.targetLocation?.radiusKm !== undefined ? String(targeting.targetLocation?.radiusKm) : ''}
                onChangeText={(text) => {
                  const parsed = Number.parseFloat(text);
                  const radius = Number.isNaN(parsed) ? 0 : parsed;
                  updateTargeting({
                    locationRadius: radius,
                    targetLocation: {
                      name: targeting.targetLocation?.name ?? targeting.locationName,
                      lat: targeting.targetLocation?.lat ?? 0,
                      lng: targeting.targetLocation?.lng ?? 0,
                      radiusKm: radius,
                    },
                  });
                }}
                editable={!loading}
              />
            </View>
          </View>
        </View>

        {/* Save Button */}
        <Pressable
          onPress={() => setPreviewVisible(true)}
          disabled={loading}
          style={[styles.previewButton, loading && styles.saveButtonDisabled]}
        >
          <Text style={styles.previewButtonText}>Preview Slide</Text>
        </Pressable>

        <Pressable
          onPress={handleSave}
          disabled={loading}
          style={[styles.saveButton, loading && styles.saveButtonDisabled]}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveButtonText}>
              {campaignId ? 'Update Campaign' : 'Create Campaign'}
            </Text>
          )}
        </Pressable>
      </ScrollView>

      <Modal
        animationType="slide"
        transparent
        visible={previewVisible}
        onRequestClose={() => setPreviewVisible(false)}
      >
        <View style={styles.previewBackdrop}>
          <View style={styles.previewModalCard}>
            <View style={styles.previewHeaderRow}>
              <Text style={styles.previewTitle}>Campaign Slide Preview</Text>
              <Pressable onPress={() => setPreviewVisible(false)}>
                <Text style={styles.previewClose}>Close</Text>
              </Pressable>
            </View>

            <Text style={styles.previewNote}>The current photo will be cropped to 16:9.</Text>

            <View style={styles.previewCardHost}>
              <SuggestionCard suggestion={previewSuggestion} preview />
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={emojiEditorVisible}
        onRequestClose={() => setEmojiEditorVisible(false)}
      >
        <View style={styles.previewBackdrop}>
          <View style={styles.emojiEditorCard}>
            <Text style={styles.previewTitle}>Edit crown emojis</Text>
            <Text style={styles.previewNote}>Use spaces between emojis. Example: ☕ ✨ 🥐</Text>
            <TextInput
              style={styles.input}
              value={emojiDraft}
              onChangeText={setEmojiDraft}
              placeholder="☕ ✨ 🥐"
              editable={!loading}
            />
            <View style={styles.emojiEditorActions}>
              <Pressable onPress={() => setEmojiEditorVisible(false)} style={styles.previewButton}>
                <Text style={styles.previewButtonText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={saveEmojiEditor} style={styles.saveButton}>
                <Text style={styles.saveButtonText}>Save emojis</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

export default BusinessCampaignFormScreen;

const createStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    backButton: {
      color: theme.colors.accent,
      fontSize: 14,
      fontWeight: '600',
      marginRight: theme.spacing.md,
    },
    headerTitle: {
      flex: 1,
      fontFamily: theme.fonts.heading,
      fontSize: 18,
      color: theme.colors.text,
    },
    scroll: {
      flex: 1,
    },
    contentContainer: {
      paddingHorizontal: theme.spacing.md,
      paddingTop: theme.spacing.lg,
      paddingBottom: theme.spacing.xl,
    },
    section: {
      marginBottom: theme.spacing.xl,
    },
    sectionTitle: {
      fontFamily: theme.fonts.semibold,
      fontSize: 16,
      color: theme.colors.text,
      marginBottom: theme.spacing.md,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
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
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 8,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      fontSize: 14,
      color: theme.colors.text,
      backgroundColor: theme.colors.card,
    },
    textAreaInput: {
      minHeight: 100,
      textAlignVertical: 'top',
    },
    builderStandardCard: {
      width: '100%',
      alignSelf: 'center',
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 12,
      overflow: 'hidden',
      backgroundColor: theme.colors.card,
      minHeight: 420,
    },
    builderCardMediaArea: {
      position: 'relative',
      width: '100%',
      height: 150,
      backgroundColor: theme.colors.backgroundAlt,
      overflow: 'hidden',
    },
    builderCardBody: {
      padding: theme.spacing.md,
      gap: 8,
      backgroundColor: theme.colors.card,
      flex: 1,
    },
    builderMediaLayer: {
      width: '100%',
      height: '100%',
      overflow: 'hidden',
    },
    builderMediaPlaceholder: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      gap: theme.spacing.xs,
      backgroundColor: theme.colors.backgroundAlt,
    },
    builderPlus: {
      width: 52,
      height: 52,
      borderRadius: 26,
      textAlign: 'center',
      lineHeight: 50,
      overflow: 'hidden',
      color: theme.colors.accent,
      borderWidth: 1,
      borderColor: theme.colors.accent,
      backgroundColor: theme.colors.accentSoft,
      fontSize: 34,
      fontFamily: theme.fonts.heading,
    },
    builderPlaceholderTitle: {
      fontFamily: theme.fonts.semibold,
      color: theme.colors.text,
      fontSize: 14,
    },
    builderPlaceholderText: {
      fontFamily: theme.fonts.body,
      color: theme.colors.textMuted,
      fontSize: 12,
    },
    builderMediaEditPill: {
      position: 'absolute',
      top: theme.spacing.sm,
      left: theme.spacing.sm,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: 'rgba(0,0,0,0.58)',
    },
    builderMediaEditText: {
      color: '#fff',
      fontFamily: theme.fonts.semibold,
      fontSize: 11,
    },
    builderLogoPlaceholder: {
      width: 32,
      height: 32,
      borderRadius: 16,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.9)',
      backgroundColor: 'rgba(0,0,0,0.45)',
    },
    builderLogoPlus: {
      color: '#fff',
      fontSize: 22,
      lineHeight: 24,
      fontFamily: theme.fonts.heading,
    },
    builderEmojiRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 2,
    },
    builderCrown: {
      fontSize: 16,
    },
    builderEmojiText: {
      flex: 1,
      fontFamily: theme.fonts.semibold,
      color: theme.colors.text,
      fontSize: 14,
    },
    builderEmojiEditButton: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.backgroundAlt,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    builderEmojiEditText: {
      color: theme.colors.text,
      fontFamily: theme.fonts.semibold,
      fontSize: 12,
    },
    builderHookInputCard: {
      color: theme.colors.accent,
      fontFamily: theme.fonts.body,
      fontSize: 12,
      padding: 0,
    },
    builderTitleInputCard: {
      color: theme.colors.text,
      fontFamily: theme.fonts.heading,
      fontSize: 20,
      padding: 0,
      minHeight: 30,
    },
    builderDescriptionInputCard: {
      color: theme.colors.textMuted,
      fontFamily: theme.fonts.body,
      fontSize: 12,
      lineHeight: 16,
      padding: 0,
      minHeight: 38,
    },
    builderCtaInputCard: {
      marginTop: 4,
      alignSelf: 'flex-start',
      minWidth: 96,
      backgroundColor: theme.colors.accent,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      color: '#fff',
      fontFamily: theme.fonts.semibold,
      fontSize: 12,
      textAlign: 'center',
    },
    primaryMediaPreview: {
      width: '100%',
      height: '100%',
      resizeMode: 'cover',
    },
    mediaPlaceholder: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      gap: theme.spacing.xs,
    },
    mediaPlaceholderIcon: {
      fontSize: 30,
    },
    mediaPlaceholderText: {
      fontSize: 12,
      color: theme.colors.textMuted,
      fontFamily: theme.fonts.body,
    },
    mediaActions: {
      marginTop: theme.spacing.sm,
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    mediaHint: {
      marginTop: theme.spacing.xs,
      fontSize: 12,
      color: theme.colors.textMuted,
      fontFamily: theme.fonts.body,
    },
    formatPickerRow: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.sm,
    },
    formatCard: {
      flex: 1,
      padding: theme.spacing.md,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.card,
      gap: 4,
    },
    formatCardActive: {
      borderColor: theme.colors.accent,
      backgroundColor: theme.colors.accentSoft,
    },
    formatCardTitle: {
      fontFamily: theme.fonts.semibold,
      fontSize: 13,
      color: theme.colors.text,
    },
    formatCardTitleActive: {
      color: theme.colors.accent,
    },
    formatCardCrop: {
      fontFamily: theme.fonts.semibold,
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    formatCardCropActive: {
      color: theme.colors.accent,
    },
    formatCardText: {
      fontFamily: theme.fonts.body,
      fontSize: 11,
      color: theme.colors.textMuted,
      lineHeight: 14,
    },
    formatCardTextActive: {
      color: theme.colors.text,
    },
    cropRequirementBox: {
      marginTop: theme.spacing.sm,
      padding: theme.spacing.sm,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.backgroundAlt,
    },
    cropRequirementTitle: {
      fontFamily: theme.fonts.semibold,
      fontSize: 12,
      color: theme.colors.text,
    },
    cropRequirementText: {
      marginTop: 2,
      fontFamily: theme.fonts.body,
      fontSize: 11,
      lineHeight: 15,
      color: theme.colors.textMuted,
    },
    mediaButton: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.accent,
      backgroundColor: theme.colors.accentSoft,
    },
    mediaButtonText: {
      color: theme.colors.accent,
      fontFamily: theme.fonts.semibold,
      fontSize: 13,
    },
    mediaStrip: {
      paddingTop: theme.spacing.sm,
      paddingBottom: 2,
      gap: theme.spacing.sm,
    },
    mediaThumbWrap: {
      width: 64,
      height: 64,
      borderRadius: 8,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.card,
    },
    mediaThumb: {
      width: '100%',
      height: '100%',
      resizeMode: 'cover',
    },
    mediaRemoveBtn: {
      position: 'absolute',
      top: 2,
      right: 2,
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: 'rgba(0,0,0,0.65)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    mediaRemoveText: {
      color: '#fff',
      fontSize: 14,
      lineHeight: 14,
      fontWeight: '700',
    },
    categoryScroll: {
      marginHorizontal: -theme.spacing.md,
      paddingHorizontal: theme.spacing.md,
    },
    categoryButton: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderRadius: 20,
      backgroundColor: theme.colors.card,
      borderWidth: 1,
      borderColor: theme.colors.border,
      marginRight: theme.spacing.sm,
    },
    categoryButtonActive: {
      backgroundColor: theme.colors.accent,
      borderColor: theme.colors.accent,
    },
    categoryButtonText: {
      fontSize: 12,
      fontWeight: '600',
      color: theme.colors.text,
    },
    optionButton: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
      marginBottom: theme.spacing.sm,
      backgroundColor: theme.colors.card,
    },
    optionButtonActive: {
      backgroundColor: theme.colors.accent,
      borderColor: theme.colors.accent,
    },
    optionText: {
      fontSize: 14,
      color: theme.colors.text,
    },
    optionTextActive: {
      color: '#fff',
      fontWeight: '600',
    },
    retrieveRow: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.sm,
      flexWrap: 'wrap',
    },
    retrieveChip: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: theme.colors.card,
    },
    retrieveChipActive: {
      borderColor: theme.colors.accent,
      backgroundColor: theme.colors.accentSoft,
    },
    retrieveChipText: {
      color: theme.colors.textMuted,
      fontFamily: theme.fonts.semibold,
      fontSize: 12,
    },
    retrieveChipTextActive: {
      color: theme.colors.accent,
    },
    rowInputs: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.sm,
    },
    halfInput: {
      flex: 1,
    },
    thirdInput: {
      flex: 1,
    },
    saveButton: {
      paddingVertical: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      backgroundColor: theme.colors.accent,
      borderRadius: 8,
      alignItems: 'center',
      marginTop: theme.spacing.md,
    },
    previewButton: {
      paddingVertical: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      backgroundColor: theme.colors.backgroundAlt,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.accent,
      alignItems: 'center',
      marginTop: theme.spacing.lg,
    },
    previewButtonText: {
      color: theme.colors.accent,
      fontFamily: theme.fonts.semibold,
      fontSize: 16,
    },
    saveButtonDisabled: {
      opacity: 0.6,
    },
    saveButtonText: {
      color: '#fff',
      fontFamily: theme.fonts.semibold,
      fontSize: 16,
    },
    previewBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.md,
    },
    previewModalCard: {
      width: '100%',
      maxWidth: 420,
      backgroundColor: theme.colors.card,
      borderRadius: 14,
      padding: theme.spacing.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: 'center',
      gap: theme.spacing.md,
    },
    previewCardHost: {
      width: '100%',
      marginTop: 56,
    },
    previewHeaderRow: {
      width: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    previewModeRow: {
      width: '100%',
      flexDirection: 'row',
      gap: theme.spacing.sm,
      flexWrap: 'wrap',
    },
    previewModeChip: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.xs,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.backgroundAlt,
    },
    previewModeChipActive: {
      borderColor: theme.colors.accent,
      backgroundColor: theme.colors.accentSoft,
    },
    previewModeChipText: {
      fontFamily: theme.fonts.semibold,
      color: theme.colors.textMuted,
      fontSize: 12,
    },
    previewModeChipTextActive: {
      color: theme.colors.accent,
    },
    previewNote: {
      width: '100%',
      fontFamily: theme.fonts.body,
      fontSize: 11,
      lineHeight: 15,
      color: theme.colors.textMuted,
    },
    previewTitle: {
      fontFamily: theme.fonts.semibold,
      color: theme.colors.text,
      fontSize: 15,
    },
    previewClose: {
      fontFamily: theme.fonts.semibold,
      color: theme.colors.accent,
      fontSize: 13,
    },
    previewSlide: {
      borderRadius: 14,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.backgroundAlt,
    },
    storySlide: {
      alignSelf: 'center',
    },
    cardSlide: {
      minHeight: 320,
    },
    previewSlideImage: {
      width: '100%',
      height: '100%',
      resizeMode: 'cover',
    },
    previewSlidePlaceholder: {
      width: '100%',
      height: '100%',
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: theme.colors.backgroundAlt,
      gap: theme.spacing.xs,
    },
    previewSlidePlaceholderIcon: {
      fontSize: 32,
    },
    previewSlidePlaceholderText: {
      color: theme.colors.textMuted,
      fontFamily: theme.fonts.body,
      fontSize: 12,
    },
    previewBadgeWrap: {
      alignSelf: 'flex-start',
    },
    previewTopRow: {
      position: 'absolute',
      top: theme.spacing.sm,
      left: theme.spacing.sm,
      right: theme.spacing.sm,
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
    },
    cardTopRow: {
      position: 'absolute',
      top: theme.spacing.sm,
      left: theme.spacing.sm,
      right: theme.spacing.sm,
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
    },
    previewBadge: {
      backgroundColor: 'rgba(0,0,0,0.7)',
      color: '#fff',
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      fontSize: 11,
      fontFamily: theme.fonts.semibold,
      overflow: 'hidden',
    },
    previewLogoWrap: {
      width: 28,
      height: 28,
      borderRadius: 14,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.85)',
      backgroundColor: 'rgba(255,255,255,0.92)',
    },
    previewLogo: {
      width: '100%',
      height: '100%',
      resizeMode: 'cover',
    },
    previewContentOverlay: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
      backgroundColor: 'rgba(0,0,0,0.55)',
      gap: 6,
    },
    previewHook: {
      color: '#D1D5DB',
      fontFamily: theme.fonts.body,
      fontSize: 12,
    },
    previewMainTitle: {
      color: '#fff',
      fontFamily: theme.fonts.heading,
      fontSize: 20,
    },
    previewDescription: {
      color: '#E5E7EB',
      fontFamily: theme.fonts.body,
      fontSize: 12,
      lineHeight: 16,
    },
    previewCtaButton: {
      marginTop: 6,
      alignSelf: 'flex-start',
      backgroundColor: theme.colors.accent,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    previewCtaText: {
      color: '#fff',
      fontFamily: theme.fonts.semibold,
      fontSize: 12,
    },
    previewEmojiRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    previewCrown: {
      fontSize: 15,
    },
    previewEmojiText: {
      color: theme.colors.text,
      fontFamily: theme.fonts.semibold,
      fontSize: 13,
    },
    cardMediaWrap: {
      position: 'relative',
      width: '100%',
      height: 124,
      backgroundColor: theme.colors.backgroundAlt,
      overflow: 'hidden',
    },
    cardMedia: {
      width: '100%',
      height: '100%',
      resizeMode: 'cover',
    },
    cardMediaPlaceholder: {
      width: '100%',
      height: '100%',
      justifyContent: 'center',
      alignItems: 'center',
      gap: theme.spacing.xs,
      backgroundColor: theme.colors.backgroundAlt,
    },
    cardBody: {
      padding: theme.spacing.md,
      gap: 6,
      backgroundColor: theme.colors.card,
    },
    previewHookCard: {
      color: theme.colors.accent,
      fontFamily: theme.fonts.semibold,
      fontSize: 11,
    },
    previewMainTitleCard: {
      color: theme.colors.text,
      fontFamily: theme.fonts.heading,
      fontSize: 18,
    },
    previewDescriptionCard: {
      color: theme.colors.textMuted,
      fontFamily: theme.fonts.body,
      fontSize: 12,
      lineHeight: 16,
    },
    previewCtaButtonCard: {
      marginTop: 4,
      alignSelf: 'flex-start',
      backgroundColor: theme.colors.accent,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    emojiEditorCard: {
      width: '100%',
      maxWidth: 420,
      backgroundColor: theme.colors.card,
      borderRadius: 14,
      padding: theme.spacing.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      gap: theme.spacing.md,
    },
    emojiEditorActions: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      justifyContent: 'flex-end',
    },
  });
