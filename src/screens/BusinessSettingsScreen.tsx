import React, { useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Pressable,
  Alert,
  Linking,
  Image,
} from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';
import { useAppState } from '../state/AppState';
import { PrimaryButton } from '../components/PrimaryButton';
import { ToggleRow } from '../components/ToggleRow';
import { updateBusinessProfile } from '../services/business';
import * as ImagePicker from 'expo-image-picker';

type Props = StackScreenProps<RootStackParamList, 'BusinessSettings'>;

const SUPPORT_ADMIN_EMAILS: string[] = String(
  process.env.EXPO_PUBLIC_SUPPORT_EMAILS
    ?? process.env.EXPO_PUBLIC_BUSINESS_ADMIN_EMAILS
    ?? process.env.EXPO_PUBLIC_ADMIN_EMAILS
    ?? '',
)
  .split(',')
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0);

export const BusinessSettingsScreen: React.FC<Props> = ({
  navigation,
}) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { state, actions } = useAppState();

  const business = state.businessProfile;

  const [businessName, setBusinessName] = useState(business?.businessName || '');
  const [description, setDescription] = useState(business?.description || '');
  const [email, setEmail] = useState(business?.email || '');
  const [phone, setPhone] = useState(business?.phone || '');
  const [website, setWebsite] = useState(business?.website || '');
  const [address, setAddress] = useState(business?.location?.address || '');
  const [city, setCity] = useState(business?.location?.city || '');
  const [country, setCountry] = useState(business?.location?.country || '');
  const [instagram, setInstagram] = useState(business?.socialLinks?.instagram || '');
  const [facebook, setFacebook] = useState(business?.socialLinks?.facebook || '');

  const [saving, setSaving] = useState(false);
  const [localLogo, setLocalLogo] = useState<string | undefined>(business?.logo?.url);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const handleContactSupport = async () => {
    if (SUPPORT_ADMIN_EMAILS.length === 0) {
      Alert.alert('Support unavailable', 'No support recipients are configured yet.');
      return;
    }

    const sender = state.userEmail?.trim() || email.trim() || 'unknown sender';
    const businessLabel = businessName.trim() || business.businessName;
    const subject = encodeURIComponent(`Support request - ${businessLabel}`);
    const body = encodeURIComponent(
      `Business: ${businessLabel}\nSender: ${sender}\n\nPlease describe your issue:`,
    );
    const bcc = encodeURIComponent(SUPPORT_ADMIN_EMAILS.join(','));
    const mailto = `mailto:?bcc=${bcc}&subject=${subject}&body=${body}`;

    try {
      const supported = await Linking.canOpenURL(mailto);
      if (!supported) {
        Alert.alert('Mail app unavailable', 'No email client is available on this device.');
        return;
      }
      await Linking.openURL(mailto);
    } catch (error) {
      console.error('Failed to open support email composer', error);
      Alert.alert('Error', 'Could not open your email app. Please try again.');
    }
  };

  const handleSave = async () => {
    if (!business) return;

    if (!businessName.trim()) {
      Alert.alert('Error', 'Please enter a business name');
      return;
    }

    setSaving(true);
    try {
      const trimmedInstagram = instagram.trim();
      const trimmedFacebook = facebook.trim();

      const socialLinksPayload: { instagram?: string; facebook?: string } = {};
      if (trimmedInstagram.length > 0) socialLinksPayload.instagram = trimmedInstagram;
      if (trimmedFacebook.length > 0) socialLinksPayload.facebook = trimmedFacebook;

      await updateBusinessProfile(business.id, {
        businessName: businessName.trim(),
        description: description.trim(),
        email: email.trim(),
        phone: phone.trim(),
        website: website.trim(),
        location: {
          ...business.location,
          address: address.trim(),
          city: city.trim(),
          country: country.trim(),
        },
        socialLinks: socialLinksPayload,
        ...(localLogo ? { logo: { url: localLogo, uploadedAt: new Date().toISOString() } } : {}),
      });
      Alert.alert('Success', 'Profile updated');
      navigation.reset({ index: 0, routes: [{ name: 'BusinessHub' }] });
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

        <Text style={styles.title}>Business Settings</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Business mode</Text>
          <ToggleRow
            label="Business-only mode"
            value={state.isBusinessOnly}
            onValueChange={(value) => {
              if (value) {
                Alert.alert(
                  'Enable business-only mode?',
                  'Consumer screens will be hidden until you turn this off again.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Enable',
                      onPress: () => {
                        actions.setIsBusinessOnly(true);
                        navigation.reset({ index: 0, routes: [{ name: 'BusinessHub' }] });
                      },
                    },
                  ],
                );
                return;
              }

              Alert.alert(
                'Disable business-only mode?',
                'Home, Deck, and AI queuing will come back for this account.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Disable',
                    onPress: () => {
                      actions.setIsBusinessOnly(false);
                      navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
                    },
                  },
                ],
              );
            }}
          />
          <Text style={styles.sectionSubtitle}>
            This mode hides consumer screens until you switch it off again.
          </Text>
        </View>

        {/* Profile Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Business info</Text>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Business logo</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 56, height: 56, borderRadius: 8, overflow: 'hidden', backgroundColor: theme.colors.backgroundAlt }}>
                {localLogo ? <Image source={{ uri: localLogo }} style={{ width: '100%', height: '100%', resizeMode: 'cover' }} /> : null}
              </View>
              <Pressable
                onPress={async () => {
                  setUploadingLogo(true);
                  try {
                    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
                    if (!permission.granted) {
                      Alert.alert('Permission required', 'Please allow photo access to upload your logo.');
                      return;
                    }
                    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.9 });
                    if (res.canceled || !res.assets.length) return;
                    const asset = res.assets[0];
                    setLocalLogo(asset.uri);
                  } catch (e) {
                    console.error(e);
                  } finally {
                    setUploadingLogo(false);
                  }
                }}
                style={styles.mediaButton}
              >
                <Text style={styles.mediaButtonText}>{uploadingLogo ? 'Uploading...' : localLogo ? 'Change logo' : 'Upload logo'}</Text>
              </Pressable>
            </View>
          </View>

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
            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={description}
              onChangeText={setDescription}
              placeholder="What does your business do?"
              placeholderTextColor={theme.colors.textMuted}
              multiline
              maxLength={200}
            />
            <Text style={styles.hint}>{description.length}/200</Text>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="contact@business.com"
              placeholderTextColor={theme.colors.textMuted}
              keyboardType="email-address"
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Phone</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="+49 (0) 123 456789"
              placeholderTextColor={theme.colors.textMuted}
              keyboardType="phone-pad"
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Website</Text>
            <TextInput
              style={styles.input}
              value={website}
              onChangeText={setWebsite}
              placeholder="https://www.business.com"
              placeholderTextColor={theme.colors.textMuted}
            />
          </View>
        </View>

        {/* Location */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Location</Text>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Address</Text>
            <TextInput
              style={styles.input}
              value={address}
              onChangeText={setAddress}
              placeholder="Street address"
              placeholderTextColor={theme.colors.textMuted}
            />
          </View>

          <View style={styles.row}>
            <View style={[styles.formGroup, styles.halfWidth]}>
              <Text style={styles.label}>City</Text>
              <TextInput
                style={styles.input}
                value={city}
                onChangeText={setCity}
                placeholder="City"
                placeholderTextColor={theme.colors.textMuted}
              />
            </View>
            <View style={[styles.formGroup, styles.halfWidth]}>
              <Text style={styles.label}>Country</Text>
              <TextInput
                style={styles.input}
                value={country}
                onChangeText={setCountry}
                placeholder="Country"
                placeholderTextColor={theme.colors.textMuted}
              />
            </View>
          </View>
        </View>

        {/* Social Media */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Social media</Text>
          <Text style={styles.sectionSubtitle}>
            Link your social profiles (optional)
          </Text>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Instagram</Text>
            <View style={styles.socialInputCont}>
              <Text style={styles.socialPrefix}>@</Text>
              <TextInput
                style={styles.socialInput}
                value={instagram}
                onChangeText={setInstagram}
                placeholder="username"
                placeholderTextColor={theme.colors.textMuted}
              />
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Facebook</Text>
            <View style={styles.socialInputCont}>
              <Text style={styles.socialPrefix}>facebook.com/</Text>
              <TextInput
                style={styles.socialInput}
                value={facebook}
                onChangeText={setFacebook}
                placeholder="username"
                placeholderTextColor={theme.colors.textMuted}
              />
            </View>
          </View>
        </View>

        {/* Account Status */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account status</Text>
          <View style={styles.statusBox}>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>Verification</Text>
              <Text style={styles.statusValue}>
                {business.verificationStatus === 'verified' ? '✅ Verified' : '⏳ Pending'}
              </Text>
            </View>
            {business.verificationStatus === 'pending' && (
              <Text style={styles.statusNote}>
                Your account is under review. This usually takes 1-2 business days.
              </Text>
            )}
            {business.verificationStatus === 'verified' && (
              <Text style={styles.statusNote}>
                ✓ Your account is verified and can run campaigns
              </Text>
            )}
          </View>

          <View style={styles.statusBox}>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>Member since</Text>
              <Text style={styles.statusValue}>
                {new Date(business.createdAt).toLocaleDateString()}
              </Text>
            </View>
          </View>
        </View>

        {/* Support */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Support</Text>
          <Pressable style={styles.supportLink} onPress={handleContactSupport}>
            <Text style={styles.supportLinkText}>📧 Contact support</Text>
          </Pressable>
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
      borderWidth: 1,
      borderColor: theme.colors.border,
      shadowColor: theme.colors.shadow,
      shadowOpacity: 0.04,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 1,
    },
    sectionTitle: {
      fontFamily: theme.fonts.semibold,
      fontSize: 16,
      color: theme.colors.text,
      marginBottom: theme.spacing.md,
    },
    sectionSubtitle: {
      fontFamily: theme.fonts.body,
      fontSize: 13,
      color: theme.colors.textMuted,
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
      borderWidth: 1,
      borderColor: theme.colors.border,
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
    socialInputCont: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.backgroundAlt,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.sm,
      paddingHorizontal: theme.spacing.md,
      overflow: 'hidden',
    },
    socialPrefix: {
      fontFamily: theme.fonts.body,
      color: theme.colors.textMuted,
    },
    socialInput: {
      flex: 1,
      paddingVertical: 12,
      paddingHorizontal: theme.spacing.sm,
      fontFamily: theme.fonts.body,
      color: theme.colors.text,
    },
    statusBox: {
      backgroundColor: theme.colors.backgroundAlt,
      borderRadius: theme.radius.md,
      padding: theme.spacing.md,
      marginBottom: theme.spacing.md,
    },
    statusRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    statusLabel: {
      fontFamily: theme.fonts.semibold,
      fontSize: 13,
      color: theme.colors.text,
    },
    statusValue: {
      fontFamily: theme.fonts.semibold,
      fontSize: 13,
      color: theme.colors.accent,
    },
    statusNote: {
      fontFamily: theme.fonts.body,
      fontSize: 12,
      color: theme.colors.textMuted,
      marginTop: theme.spacing.sm,
    },
    supportLink: {
      paddingVertical: theme.spacing.md,
    },
    supportLinkText: {
      fontFamily: theme.fonts.semibold,
      fontSize: 14,
      color: theme.colors.accent,
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
