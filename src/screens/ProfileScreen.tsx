import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { RootStackParamList } from '../navigation/types';
import { PrimaryButton } from '../components/PrimaryButton';
import { useTheme } from '../theme/ThemeProvider';
import { useAppState } from '../state/AppState';
import { signOutUser } from '../services/auth';
import { firebaseEnabled } from '../services/firebase';
import { isBusinessAdmin } from '../services/user';
import { getAvatarInitial } from '../utils/social';
import { loadProfileAvatarUri, saveProfileAvatarUri } from '../utils/storage';
import { useI18n } from '../i18n/I18nProvider';

type Props = StackScreenProps<RootStackParamList, 'Profile'>;

export const ProfileScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { state, actions } = useAppState();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [profileAvatarUri, setProfileAvatarUri] = useState<string | null>(null);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const isAdmin = isBusinessAdmin(state.userEmail);

  useEffect(() => {
    let active = true;
    loadProfileAvatarUri(state.userId)
      .then((uri) => {
        if (active) setProfileAvatarUri(uri);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [state.userId]);

  const handleSignOut = async () => {
    await signOutUser();
  };

  const handleRetakeOnboarding = () => {
    if (!isAdmin) return;
    Alert.alert(
      t('profile_retake_title'),
      t('profile_retake_body'),
      [
        { text: t('common_cancel'), style: 'cancel' },
        {
          text: t('profile_retake_confirm'),
          style: 'destructive',
          onPress: () => {
            actions.resetOnboarding();
            navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] });
          },
        },
      ],
    );
  };

  const handleTogglePremium = () => {
    if (!isAdmin) return;
    const nextPremium = !state.isPremium;
    Alert.alert(
      nextPremium ? t('profile_enable_premium_title') : t('profile_disable_premium_title'),
      nextPremium
        ? t('profile_enable_premium_body')
        : t('profile_disable_premium_body'),
      [
        { text: t('common_cancel'), style: 'cancel' },
        {
          text: nextPremium ? t('common_enable') : t('common_disable'),
          onPress: () => actions.setPremiumActive(nextPremium),
        },
      ],
    );
  };

  const pickProfilePhoto = async () => {
    if (avatarLoading) return;
    setAvatarLoading(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('profile_permission_title'), t('profile_permission_body'));
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });

      if (result.canceled) return;
      const uri = result.assets[0]?.uri ?? null;
      if (!uri) return;
      setProfileAvatarUri(uri);
      await saveProfileAvatarUri(uri, state.userId);
    } catch (error) {
      console.warn('[ProfileScreen] avatar pick failed', error);
      Alert.alert(t('profile_update_photo_title'), t('profile_update_photo_body'));
    } finally {
      setAvatarLoading(false);
    }
  };

  const signedInLabel = state.userEmail ?? state.userId ?? 'Guest';
  const avatarInitial = getAvatarInitial(state.userEmail);
  const canEditAvatar = !!state.userId;

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={styles.container}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + theme.spacing.sm }]}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>{t('common_back')}</Text>
        </Pressable>

        <View style={styles.headerRow}>
          <Pressable
            style={({ pressed }) => [styles.avatarButton, pressed && styles.avatarPressed]}
            onPress={pickProfilePhoto}
            disabled={!canEditAvatar || avatarLoading}
          >
            {profileAvatarUri ? (
              <Image source={{ uri: profileAvatarUri }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarInitial}>{avatarInitial}</Text>
            )}
          </Pressable>

          <View style={styles.headerCopy}>
            <Text style={[styles.title, isAdmin && styles.adminTitle]}>
              {isAdmin ? t('profile_admin_title') : t('profile_title')}
            </Text>
            <Text style={styles.subtitle}>
              {t('profile_signed_in_as', { value: signedInLabel })}
            </Text>
            <Pressable onPress={pickProfilePhoto} disabled={!canEditAvatar || avatarLoading}>
              <Text style={styles.avatarActionText}>
                {profileAvatarUri ? t('profile_change_picture') : t('profile_add_picture')}
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('profile_account')}</Text>
          <PrimaryButton label={t('profile_logout')} onPress={handleSignOut} />
          {!firebaseEnabled && (
            <Text style={styles.rowText}>Firebase config missing. Add it to enable accounts.</Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('profile_setup')}</Text>
          <PrimaryButton
            label={t('profile_edit_preferences')}
            onPress={() => navigation.navigate('Settings')}
          />
          <PrimaryButton
            label={t('profile_my_activities')}
            onPress={() => navigation.navigate('MyActivities')}
          />
          <PrimaryButton
            label={t('profile_submit_business_ad')}
            onPress={() => navigation.navigate('BusinessHub')}
          />
        </View>

        {isAdmin && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('profile_admin_section')}</Text>
            <Text style={styles.rowText}>{t('profile_admin_hint')}</Text>
            <Text style={styles.rowText}>{t('profile_premium_status', { value: state.isPremium ? t('profile_enabled') : t('profile_disabled') })}</Text>
            <PrimaryButton
              label={t('profile_review_approvals')}
              onPress={() => navigation.navigate('ApprovalQueue')}
            />
            <PrimaryButton
              label={state.isPremium ? t('profile_disable_premium') : t('profile_enable_premium')}
              onPress={handleTogglePremium}
            />
            <PrimaryButton
              label={t('profile_retake_onboarding')}
              onPress={handleRetakeOnboarding}
            />
          </View>
        )}
      </ScrollView>
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    padding: theme.spacing.lg,
  },
  back: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    marginTop: theme.spacing.sm,
  },
  avatarButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#D6DADF',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  avatarPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.98 }],
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarInitial: {
    fontFamily: theme.fonts.semibold,
    fontSize: 28,
    color: '#5E6670',
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontFamily: theme.fonts.heading,
    fontSize: 28,
    color: theme.colors.text,
  },
  adminTitle: {
    color: '#2F6BFF',
  },
  subtitle: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
  },
  avatarActionText: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.accentDark,
    marginTop: 4,
  },
  avatarDisabledText: {
    opacity: 0.5,
  },
  section: {
    marginTop: theme.spacing.lg,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.sm,
    shadowColor: theme.colors.shadow,
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  sectionTitle: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
  },
  rowText: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
  },
});
