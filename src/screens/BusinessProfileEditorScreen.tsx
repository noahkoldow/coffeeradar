import React, { useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Pressable,
  Alert,
  Image,
  ActivityIndicator,
} from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';
import { useAppState } from '../state/AppState';
import { PrimaryButton } from '../components/PrimaryButton';
import * as ImagePicker from 'expo-image-picker';

type Props = StackScreenProps<RootStackParamList, 'Deck'>;

interface BusinessProfileEditorScreenProps
  extends StackScreenProps<RootStackParamList, 'Deck'> {}

export const BusinessProfileEditorScreen: React.FC<
  BusinessProfileEditorScreenProps
> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { state } = useAppState();

  const business = state.businessProfile;

  const [logoUri, setLogoUri] = useState(business?.logo || '');
  const [businessName, setBusinessName] = useState(business?.businessName || '');
  const [tagline, setTagline] = useState(business?.tagline || '');
  const [about, setAbout] = useState(business?.about || '');
  const [saving, setSaving] = useState(false);

  const handlePickLogo = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled) {
      setLogoUri(result.assets[0].uri);
    }
  };

  const handleSave = async () => {
    if (!businessName.trim()) {
      Alert.alert('Error', 'Please enter a business name');
      return;
    }

    setSaving(true);
    try {
      // In a real implementation, upload logo and save profile
      Alert.alert('Success', 'Profile updated');
      navigation.goBack();
    } catch (error) {
      console.error('Error saving profile:', error);
      Alert.alert('Error', 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  if (!business) {
    return (
      <LinearGradient
        colors={[theme.colors.background, theme.colors.backgroundAlt]}
        style={[styles.container, { paddingTop: insets.top }]}
      >
        <View style={styles.centerContent}>
          <Text style={styles.errorText}>No business profile found</Text>
        </View>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient
      colors={[theme.colors.background, theme.colors.backgroundAlt]}
      style={[styles.container, { paddingTop: insets.top }]}
    >
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
        </View>

        <Text style={styles.title}>Business profile</Text>

        {/* Logo section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Logo</Text>
          <Pressable style={styles.logoContainer} onPress={handlePickLogo}>
            {logoUri ? (
              <Image source={{ uri: logoUri }} style={styles.logoImage} />
            ) : (
              <View style={styles.logoPlaceholder}>
                <Text style={styles.logoPlaceholderText}>📸</Text>
                <Text style={styles.logoPlaceholderHint}>Add logo</Text>
              </View>
            )}
          </Pressable>
          <Text style={styles.logoHint}>
            Square image (PNG, JPG) • Max 5MB • Will be visible on campaigns
          </Text>
        </View>

        {/* Info section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Branding</Text>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Business name</Text>
            <TextInput
              style={styles.input}
              value={businessName}
              onChangeText={setBusinessName}
              placeholder="Your business name"
              placeholderTextColor={theme.colors.textMuted}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Tagline</Text>
            <TextInput
              style={styles.input}
              value={tagline}
              onChangeText={setTagline}
              placeholder="Short brand message (e.g., 'Best coffee in Berlin')"
              placeholderTextColor={theme.colors.textMuted}
              maxLength={80}
            />
            <Text style={styles.hint}>{tagline.length}/80</Text>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>About</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={about}
              onChangeText={setAbout}
              placeholder="Tell users about your business..."
              placeholderTextColor={theme.colors.textMuted}
              multiline
              maxLength={500}
            />
            <Text style={styles.hint}>{about.length}/500</Text>
          </View>
        </View>

        {/* Verification badge */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Badge & verification</Text>
          <View style={styles.badgeBox}>
            <View style={styles.badgeContent}>
              <Text style={styles.badgeIcon}>✓</Text>
              <View style={styles.badgeInfo}>
                <Text style={styles.badgeTitle}>Verified badge</Text>
                <Text style={styles.badgeDesc}>
                  {business.verificationStatus === 'verified'
                    ? "You have a verified badge - users trust you more"
                    : 'Get verified to build user trust and credibility'}
                </Text>
              </View>
            </View>
            {business.verificationStatus !== 'verified' && (
              <PrimaryButton
                label="Apply for badge"
                onPress={() => {
                  Alert.alert(
                    'Verify your business',
                    'We will verify your identity and business details.\n\nRequired:\n• Photo ID\n• Business license/registration\n• Address verification\n\nThis usually takes 1-2 business days.'
                  );
                }}
                compact
              />
            )}
          </View>
        </View>

        {/* Branding guidelines */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Brand guidelines</Text>
          <View style={styles.guidelineBox}>
            <Text style={styles.guidelineTitle}>Colors</Text>
            <View style={styles.colorRow}>
              <View
                style={[
                  styles.colorBox,
                  { backgroundColor: theme.colors.accent },
                ]}
              />
              <Text style={styles.colorLabel}>Primary: {theme.colors.accent}</Text>
            </View>
            <Text style={styles.guidelineHint}>
              Your brand color will be used for campaign highlights
            </Text>
          </View>

          <View style={styles.guidelineBox}>
            <Text style={styles.guidelineTitle}>Voice</Text>
            <Pressable style={styles.guidanceItem}>
              <Text style={styles.guidanceEmoji}>💬</Text>
              <Text style={styles.guidanceText}>Keep it conversational and friendly</Text>
            </Pressable>
            <Pressable style={styles.guidanceItem}>
              <Text style={styles.guidanceEmoji}>🎯</Text>
              <Text style={styles.guidanceText}>Be clear about what users get</Text>
            </Pressable>
            <Pressable style={styles.guidanceItem}>
              <Text style={styles.guidanceEmoji}>⚡</Text>
              <Text style={styles.guidanceText}>Create urgency with time-limited offers</Text>
            </Pressable>
          </View>
        </View>

        {/* Brand assets */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Brand assets</Text>
          <View style={styles.assetsGrid}>
            <Pressable style={styles.assetCard}>
              <Text style={styles.assetIcon}>📱</Text>
              <Text style={styles.assetTitle}>Logo</Text>
            </Pressable>
            <Pressable style={styles.assetCard}>
              <Text style={styles.assetIcon}>🎨</Text>
              <Text style={styles.assetTitle}>Colors</Text>
            </Pressable>
            <Pressable style={styles.assetCard}>
              <Text style={styles.assetIcon}>🔤</Text>
              <Text style={styles.assetTitle}>Fonts</Text>
            </Pressable>
            <Pressable style={styles.assetCard}>
              <Text style={styles.assetIcon}>📝</Text>
              <Text style={styles.assetTitle}>Guidelines</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      {/* Save Button */}
      <View style={styles.footer}>
        <PrimaryButton
          label={saving ? 'Saving...' : 'Save Changes'}
          onPress={handleSave}
          disabled={saving}
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
    logoContainer: {
      width: '100%',
      aspectRatio: 1,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.backgroundAlt,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: theme.spacing.md,
      overflow: 'hidden',
    },
    logoImage: {
      width: '100%',
      height: '100%',
    },
    logoPlaceholder: {
      justifyContent: 'center',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    logoPlaceholderText: {
      fontSize: 56,
    },
    logoPlaceholderHint: {
      fontFamily: theme.fonts.body,
      fontSize: 13,
      color: theme.colors.textMuted,
    },
    logoHint: {
      fontFamily: theme.fonts.body,
      fontSize: 11,
      color: theme.colors.textMuted,
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
    badgeBox: {
      backgroundColor: theme.colors.backgroundAlt,
      borderRadius: theme.radius.md,
      padding: theme.spacing.md,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    badgeContent: {
      flex: 1,
      flexDirection: 'row',
      gap: theme.spacing.md,
      alignItems: 'center',
    },
    badgeIcon: {
      fontSize: 28,
    },
    badgeInfo: {
      flex: 1,
    },
    badgeTitle: {
      fontFamily: theme.fonts.semibold,
      fontSize: 13,
      color: theme.colors.text,
      marginBottom: theme.spacing.xs,
    },
    badgeDesc: {
      fontFamily: theme.fonts.body,
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    guidelineBox: {
      backgroundColor: theme.colors.backgroundAlt,
      borderRadius: theme.radius.md,
      padding: theme.spacing.md,
      marginBottom: theme.spacing.md,
    },
    guidelineTitle: {
      fontFamily: theme.fonts.semibold,
      fontSize: 14,
      color: theme.colors.text,
      marginBottom: theme.spacing.md,
    },
    colorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      marginBottom: theme.spacing.md,
    },
    colorBox: {
      width: 40,
      height: 40,
      borderRadius: theme.radius.sm,
    },
    colorLabel: {
      flex: 1,
      fontFamily: theme.fonts.body,
      fontSize: 13,
      color: theme.colors.text,
    },
    guidelineHint: {
      fontFamily: theme.fonts.body,
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    guidanceItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
    },
    guidanceEmoji: {
      fontSize: 18,
    },
    guidanceText: {
      flex: 1,
      fontFamily: theme.fonts.body,
      fontSize: 13,
      color: theme.colors.text,
    },
    assetsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.md,
    },
    assetCard: {
      flex: 1,
      minWidth: '45%',
      aspectRatio: 1,
      backgroundColor: theme.colors.backgroundAlt,
      borderRadius: theme.radius.md,
      justifyContent: 'center',
      alignItems: 'center',
    },
    assetIcon: {
      fontSize: 32,
      marginBottom: theme.spacing.sm,
    },
    assetTitle: {
      fontFamily: theme.fonts.semibold,
      fontSize: 12,
      color: theme.colors.text,
      textAlign: 'center',
    },
    centerContent: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    errorText: {
      fontFamily: theme.fonts.body,
      fontSize: 16,
      color: theme.colors.textMuted,
    },
    footer: {
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.lg,
      backgroundColor: theme.colors.background,
    },
  });
