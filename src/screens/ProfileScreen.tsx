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

type Props = StackScreenProps<RootStackParamList, 'Profile'>;

export const ProfileScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { state } = useAppState();
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

  const pickProfilePhoto = async () => {
    if (avatarLoading) return;
    setAvatarLoading(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'Allow photo access to add a profile picture.');
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
      Alert.alert('Could not update photo', 'Please try again.');
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
          <Text style={styles.back}>Back</Text>
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
              {isAdmin ? 'ADMIN ACCOUNT' : 'Profile'}
            </Text>
            <Text style={styles.subtitle}>
              Signed in as {signedInLabel}
            </Text>
            <Pressable onPress={pickProfilePhoto} disabled={!canEditAvatar || avatarLoading}>
              <Text style={styles.avatarActionText}>
                {profileAvatarUri ? 'Change profile picture' : 'Add profile picture'}
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <PrimaryButton label="Log out" onPress={handleSignOut} />
          {!firebaseEnabled && (
            <Text style={styles.rowText}>Firebase config missing. Add it to enable accounts.</Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Profile setup</Text>
          <PrimaryButton
            label="Edit preferences"
            onPress={() => navigation.navigate('Settings')}
          />
          <PrimaryButton
            label="Submit a business ad"
            onPress={() => navigation.navigate('BusinessHub')}
          />
        </View>

        {isAdmin && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Admin</Text>
            <Text style={styles.rowText}>Pending business ads and community submissions need review here.</Text>
            <PrimaryButton
              label="Review pending approvals"
              onPress={() => navigation.navigate('ApprovalQueue')}
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
