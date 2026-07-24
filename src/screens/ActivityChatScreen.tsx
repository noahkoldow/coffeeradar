import React, { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';
import { ensureActivityChatThread, loadActivityChatThread, makeActivityChatThreadId, sendActivityChatMessage, subscribeActivityChatMessages, ActivityChatMessage } from '../services/activityChat';
import { useAppState } from '../state/AppState';
import { formatDuration } from '../utils/time';
import { useI18n } from '../i18n/I18nProvider';

type Props = StackScreenProps<RootStackParamList, 'ActivityChat'>;

export const ActivityChatScreen: React.FC<Props> = ({ navigation, route }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { language } = useI18n();
  const insets = useSafeAreaInsets();
  const { state } = useAppState();
  const [messages, setMessages] = useState<ActivityChatMessage[]>([]);
  const [threadTitle, setThreadTitle] = useState(route.params.title);
  const [composer, setComposer] = useState('');
  const [expired, setExpired] = useState(false);
  const isGerman = language === 'de';

  useEffect(() => {
    let active = true;
    const init = async () => {
      const thread = await loadActivityChatThread(route.params.threadId);
      if (!active) return;
      const expiresAt = thread?.expiresAt?.toDate?.() ?? new Date(route.params.expiresAt);
      if (expiresAt.getTime() <= Date.now()) {
        setExpired(true);
        return;
      }
      if (thread?.title) setThreadTitle(thread.title);
      await ensureActivityChatThread(route.params);
      const unsubscribe = subscribeActivityChatMessages(route.params.threadId, (nextMessages) => {
        setMessages(nextMessages);
      });
      return unsubscribe;
    };

    let cleanup: (() => void) | undefined;
    init().then((fn) => {
      cleanup = fn;
    });
    return () => {
      active = false;
      cleanup?.();
    };
  }, [route.params]);

  useEffect(() => {
    const interval = setInterval(() => {
      const expiresAt = new Date(route.params.expiresAt).getTime();
      if (expiresAt <= Date.now()) {
        setExpired(true);
      }
    }, 15_000);
    return () => clearInterval(interval);
  }, [route.params.expiresAt]);

  const remaining = Math.max(0, new Date(route.params.expiresAt).getTime() - Date.now());
  const remainingLabel = remaining > 0
    ? isGerman
      ? `${formatDuration(Math.ceil(remaining / 60000))} ubrig`
      : `${formatDuration(Math.ceil(remaining / 60000))} left`
    : isGerman
      ? 'Abgelaufen'
      : 'Expired';

  const send = async () => {
    const body = composer.trim();
    if (!body) return;
    await sendActivityChatMessage(route.params.threadId, body);
    setComposer('');
  };

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + theme.spacing.md }]}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>{isGerman ? 'Zuruck' : 'Back'}</Text>
        </Pressable>
        <Text style={styles.title}>{threadTitle}</Text>
        <Text style={styles.subtitle}>
          {isGerman ? 'Der Chat bleibt 24 Stunden offen.' : 'Chat stays open for 24 hours.'} {remainingLabel}
        </Text>
        {state.userId && (
          <Text style={styles.meta}>
            {isGerman ? 'Du chattest als ' : 'You are chatting as '}
            {state.userEmail ?? state.userId}
          </Text>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.messages}>
        {messages.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>{isGerman ? 'Sag als Erste:r hallo' : 'Be the first to say hello'}</Text>
            <Text style={styles.emptyText}>
              {isGerman
                ? 'Hier erscheinen Menschen, die zur gleichen Aktivitat gehen.'
                : 'People going to the same activity will show up here.'}
            </Text>
          </View>
        )}
        {messages.map((message) => (
          <View key={message.id} style={[styles.bubble, message.authorId === state.userId ? styles.bubbleMine : styles.bubbleOther]}>
            <Text style={styles.bubbleAuthor}>{message.authorName}</Text>
            <Text style={styles.bubbleBody}>{message.body}</Text>
          </View>
        ))}
      </ScrollView>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.composerWrap}>
        <View style={styles.composerBar}>
          <TextInput
            value={composer}
            onChangeText={setComposer}
            placeholder={expired ? (isGerman ? 'Chat abgelaufen' : 'Chat expired') : (isGerman ? 'Schreib etwas' : 'Say something')}
            editable={!expired}
            placeholderTextColor={theme.colors.textMuted}
            style={styles.input}
            multiline
          />
          <Pressable onPress={send} disabled={expired || !composer.trim()} style={({ pressed }) => [styles.sendBtn, (expired || !composer.trim()) && styles.sendBtnDisabled, pressed && !expired && composer.trim() && { opacity: 0.85 }]}>
            <Text style={styles.sendBtnText}>{isGerman ? 'Senden' : 'Send'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.md, gap: 6 },
  back: { color: theme.colors.textMuted, fontFamily: theme.fonts.semibold },
  title: { color: theme.colors.text, fontFamily: theme.fonts.heading, fontSize: 28 },
  subtitle: { color: theme.colors.textMuted, fontFamily: theme.fonts.body },
  meta: { color: theme.colors.textMuted, fontFamily: theme.fonts.semibold, fontSize: 12 },
  messages: { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md, gap: 10, paddingBottom: theme.spacing.xxl },
  emptyCard: { backgroundColor: theme.colors.card, borderRadius: theme.radius.lg, padding: theme.spacing.lg, borderWidth: 1, borderColor: theme.colors.border },
  emptyTitle: { color: theme.colors.text, fontFamily: theme.fonts.semibold, fontSize: 16 },
  emptyText: { color: theme.colors.textMuted, fontFamily: theme.fonts.body, marginTop: 6 },
  bubble: { maxWidth: '84%', borderRadius: 22, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleMine: { alignSelf: 'flex-end', backgroundColor: theme.colors.accent },
  bubbleOther: { alignSelf: 'flex-start', backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border },
  bubbleAuthor: { color: theme.colors.textMuted, fontFamily: theme.fonts.semibold, fontSize: 11, marginBottom: 4 },
  bubbleBody: { color: theme.colors.text, fontFamily: theme.fonts.body, fontSize: 14, lineHeight: 20 },
  composerWrap: { paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.lg },
  composerBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, backgroundColor: theme.colors.card, borderRadius: theme.radius.lg, padding: 10, borderWidth: 1, borderColor: theme.colors.border },
  input: { flex: 1, minHeight: 44, maxHeight: 120, color: theme.colors.text, fontFamily: theme.fonts.body, paddingVertical: 8 },
  sendBtn: { backgroundColor: theme.colors.accent, borderRadius: theme.radius.md, paddingHorizontal: 14, paddingVertical: 12 },
  sendBtnDisabled: { opacity: 0.45 },
  sendBtnText: { color: theme.colors.accentText, fontFamily: theme.fonts.semibold },
});
