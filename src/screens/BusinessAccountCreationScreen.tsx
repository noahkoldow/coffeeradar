import React, { useState, useMemo } from 'react';
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
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../theme/ThemeProvider';
import { BusinessProfile, BusinessCategory } from '../types/business';
import { BusinessHeader } from '../components/BusinessHeader';

interface BusinessAccountCreationProps {
  onComplete: (profile: Partial<BusinessProfile>) => void;
  onBack: () => void;
}

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

export const BusinessAccountCreationScreen: React.FC<BusinessAccountCreationProps> = ({
  onComplete,
  onBack,
}) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [loading, setLoading] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);

  const [formData, setFormData] = useState({
    businessName: '',
    category: 'restaurant' as BusinessCategory,
    logoUri: '',
    email: '',
    phone: '',
    website: '',
    description: '',
    location: {
      address: '',
      city: '',
      country: 'DE',
      lat: 0,
      lng: 0,
    },
    socialLinks: {
      instagram: '',
      facebook: '',
    },
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const handlePickLogo = async () => {
    setLogoUploading(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission required', 'Please allow photo access to upload your business logo.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });

      if (result.canceled || !result.assets.length) return;
      const asset = result.assets[0];
      setFormData((prev) => ({ ...prev, logoUri: asset.uri }));
    } catch (error) {
      console.error('Failed to pick business logo:', error);
      Alert.alert('Error', 'Could not select a logo right now. Please try again.');
    } finally {
      setLogoUploading(false);
    }
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.businessName.trim()) newErrors.businessName = 'Business name is required';
    if (!formData.email.trim()) newErrors.email = 'Email is required';
    else if (!formData.email.includes('@')) newErrors.email = 'Valid email required';
    if (!formData.location.address.trim()) newErrors.address = 'Location is required';
    if (!formData.location.city.trim()) newErrors.city = 'City is required';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    setLoading(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 800)); // simulate API call

      onComplete({
        businessName: formData.businessName,
        category: formData.category,
        logo: formData.logoUri
          ? {
              url: formData.logoUri,
              uploadedAt: new Date().toISOString(),
            }
          : undefined,
        email: formData.email,
        phone: formData.phone,
        website: formData.website,
        description: formData.description,
        location: formData.location,
        socialLinks: formData.socialLinks,
        verificationStatus: 'pending',
      });
    } catch (error) {
      Alert.alert('Error', 'Failed to create business account');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.outerContainer}>
      <BusinessHeader showSettingsIcon={false} />
      <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* Header */}
      <View style={styles.headerSection}>
        <Text style={styles.headerTitle}>Create Your Business Account</Text>
        <Text style={styles.headerSubtitle}>Tell us about your business</Text>
      </View>

      {/* Form Sections */}

      {/* Business Basics */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Business Basics</Text>

        <View style={styles.formGroup}>
          <Text style={styles.label}>General Business Logo (Optional)</Text>
          <View style={styles.logoPickerRow}>
            <View style={styles.logoPreviewBox}>
              {formData.logoUri ? (
                <Image source={{ uri: formData.logoUri }} style={styles.logoPreviewImage} />
              ) : (
                <Text style={styles.logoPreviewPlaceholder}>LOGO</Text>
              )}
            </View>
            <Pressable
              onPress={handlePickLogo}
              style={styles.logoPickerButton}
              disabled={logoUploading}
            >
              <Text style={styles.logoPickerButtonText}>
                {logoUploading ? 'Opening...' : formData.logoUri ? 'Change logo' : 'Upload logo'}
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.label}>Business Name *</Text>
          <TextInput
            style={[styles.input, errors.businessName && styles.inputError]}
            placeholder="e.g., Urban Yoga Studio"
            value={formData.businessName}
            onChangeText={(text) => setFormData({ ...formData, businessName: text })}
            placeholderTextColor={theme.colors.textMuted}
          />
          {errors.businessName && <Text style={styles.errorText}>{errors.businessName}</Text>}
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.label}>Category *</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
            {BUSINESS_CATEGORIES.map((cat) => (
              <Pressable
                key={cat.value}
                onPress={() => setFormData({ ...formData, category: cat.value })}
                style={[
                  styles.categoryButton,
                  formData.category === cat.value && styles.categoryButtonActive,
                ]}
              >
                <Text style={styles.categoryButtonText}>{cat.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.label}>Description (Optional)</Text>
          <TextInput
            style={[styles.input, styles.textAreaInput]}
            placeholder="Tell users why they should choose your business..."
            value={formData.description}
            onChangeText={(text) => setFormData({ ...formData, description: text })}
            multiline
            numberOfLines={4}
            placeholderTextColor={theme.colors.textMuted}
          />
        </View>
      </View>

      {/* Contact Information */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Contact Information</Text>

        <View style={styles.formGroup}>
          <Text style={styles.label}>Email *</Text>
          <TextInput
            style={[styles.input, errors.email && styles.inputError]}
            placeholder="business@example.com"
            value={formData.email}
            onChangeText={(text) => setFormData({ ...formData, email: text })}
            keyboardType="email-address"
            placeholderTextColor={theme.colors.textMuted}
          />
          {errors.email && <Text style={styles.errorText}>{errors.email}</Text>}
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.label}>Phone (Optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="+49 (0) 123 456789"
            value={formData.phone}
            onChangeText={(text) => setFormData({ ...formData, phone: text })}
            keyboardType="phone-pad"
            placeholderTextColor={theme.colors.textMuted}
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.label}>Website (Optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="https://yourwebsite.com"
            value={formData.website}
            onChangeText={(text) => setFormData({ ...formData, website: text })}
            keyboardType="url"
            placeholderTextColor={theme.colors.textMuted}
          />
        </View>
      </View>

      {/* Location */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Location</Text>

        <View style={styles.formGroup}>
          <Text style={styles.label}>Street Address *</Text>
          <TextInput
            style={[styles.input, errors.address && styles.inputError]}
            placeholder="Hauptstrasse 123"
            value={formData.location.address}
            onChangeText={(text) =>
              setFormData({
                ...formData,
                location: { ...formData.location, address: text },
              })
            }
            placeholderTextColor={theme.colors.textMuted}
          />
          {errors.address && <Text style={styles.errorText}>{errors.address}</Text>}
        </View>

        <View style={styles.rowGroup}>
          <View style={styles.halfItem}>
            <Text style={styles.label}>City *</Text>
            <TextInput
              style={[styles.input, errors.city && styles.inputError]}
              placeholder="Berlin"
              value={formData.location.city}
              onChangeText={(text) =>
                setFormData({
                  ...formData,
                  location: { ...formData.location, city: text },
                })
              }
              placeholderTextColor={theme.colors.textMuted}
            />
            {errors.city && <Text style={styles.errorText}>{errors.city}</Text>}
          </View>
          <View style={styles.halfItem}>
            <Text style={styles.label}>Country</Text>
            <TextInput
              style={styles.input}
              value={formData.location.country}
              onChangeText={(text) =>
                setFormData({
                  ...formData,
                  location: { ...formData.location, country: text },
                })
              }
              placeholderTextColor={theme.colors.textMuted}
            />
          </View>
        </View>
      </View>

      {/* Social Links */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Social Links (Optional)</Text>

        <View style={styles.formGroup}>
          <Text style={styles.label}>Instagram</Text>
          <TextInput
            style={styles.input}
            placeholder="@yourbusiness"
            value={formData.socialLinks.instagram}
            onChangeText={(text) =>
              setFormData({
                ...formData,
                socialLinks: { ...formData.socialLinks, instagram: text },
              })
            }
            placeholderTextColor={theme.colors.textMuted}
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.label}>Facebook</Text>
          <TextInput
            style={styles.input}
            placeholder="Your Business Page"
            value={formData.socialLinks.facebook}
            onChangeText={(text) =>
              setFormData({
                ...formData,
                socialLinks: { ...formData.socialLinks, facebook: text },
              })
            }
            placeholderTextColor={theme.colors.textMuted}
          />
        </View>
      </View>

      {/* Buttons */}
      <View style={styles.buttonGroup}>
        <Pressable onPress={onBack} style={[styles.button, styles.cancelButton]} disabled={loading}>
          <Text style={styles.cancelButtonText}>Back</Text>
        </Pressable>
        <Pressable
          onPress={handleSubmit}
          style={[styles.button, styles.submitButton]}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.submitButtonText}>Create Account</Text>
          )}
        </Pressable>
      </View>

      {/* Footer note */}
      <View style={styles.footerNote}>
        <Text style={styles.footerText}>
          Your business account will be reviewed by our team. You'll receive confirmation via email
          within 24 hours.
        </Text>
      </View>
    </ScrollView>
    </View>
  );
};

export default BusinessAccountCreationScreen;

const createStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    outerContainer: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    contentContainer: {
      paddingHorizontal: 16,
      paddingTop: 24,
      paddingBottom: 32,
    },
    headerSection: {
      marginBottom: 32,
    },
    headerTitle: {
      fontFamily: theme.fonts.heading,
      fontSize: 28,
      color: theme.colors.text,
      marginBottom: 8,
    },
    headerSubtitle: {
      fontFamily: theme.fonts.body,
      fontSize: 16,
      color: theme.colors.textMuted,
    },
    section: {
      marginBottom: 28,
    },
    sectionTitle: {
      fontFamily: theme.fonts.semibold,
      fontSize: 16,
      color: theme.colors.text,
      marginBottom: 16,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    formGroup: {
      marginBottom: 16,
    },
    logoPickerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    logoPreviewBox: {
      width: 56,
      height: 56,
      borderRadius: 12,
      backgroundColor: theme.colors.backgroundAlt,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    logoPreviewImage: {
      width: '100%',
      height: '100%',
      resizeMode: 'cover',
    },
    logoPreviewPlaceholder: {
      fontFamily: theme.fonts.semibold,
      fontSize: 11,
      color: theme.colors.textMuted,
      letterSpacing: 0.5,
    },
    logoPickerButton: {
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.card,
    },
    logoPickerButtonText: {
      fontFamily: theme.fonts.semibold,
      fontSize: 13,
      color: theme.colors.text,
    },
    label: {
      fontFamily: theme.fonts.semibold,
      fontSize: 14,
      color: theme.colors.text,
      marginBottom: 8,
    },
    input: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
      fontFamily: theme.fonts.body,
      fontSize: 15,
      color: theme.colors.text,
      backgroundColor: theme.colors.card,
    },
    inputError: {
      borderColor: '#EF4444',
      backgroundColor: '#FEE2E2',
    },
    textAreaInput: {
      minHeight: 100,
      textAlignVertical: 'top',
    },
    errorText: {
      fontFamily: theme.fonts.body,
      fontSize: 12,
      color: '#EF4444',
      marginTop: 6,
    },
    categoryScroll: {
      marginHorizontal: -16,
      paddingHorizontal: 16,
    },
    categoryButton: {
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.card,
      marginRight: 8,
    },
    categoryButtonActive: {
      backgroundColor: theme.colors.accent,
      borderColor: theme.colors.accent,
    },
    categoryButtonText: {
      fontFamily: theme.fonts.semibold,
      fontSize: 12,
      color: theme.colors.text,
    },
    rowGroup: {
      flexDirection: 'row',
      gap: 12,
    },
    halfItem: {
      flex: 1,
    },
    buttonGroup: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 32,
    },
    button: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
    },
    cancelButton: {
      backgroundColor: theme.colors.backgroundAlt,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    cancelButtonText: {
      fontFamily: theme.fonts.semibold,
      fontSize: 14,
      color: theme.colors.text,
    },
    submitButton: {
      backgroundColor: theme.colors.accent,
    },
    submitButtonText: {
      fontFamily: theme.fonts.semibold,
      fontSize: 14,
      color: '#FFFFFF',
    },
    footerNote: {
      marginTop: 24,
      paddingHorizontal: 12,
      paddingVertical: 14,
      backgroundColor: theme.colors.accentSoft,
      borderRadius: 12,
    },
    footerText: {
      fontFamily: theme.fonts.body,
      fontSize: 13,
      color: theme.colors.accentDark,
      lineHeight: 18,
    },
  });
