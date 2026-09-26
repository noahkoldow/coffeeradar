import React, { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';
import { ACTIVITY_CHAT_MESSAGE_MAX_LENGTH, ensureActivityChatThread, loadActivityChatThread, markActivityChatParticipant, normalizeActivityChatDisplayName, sendActivityChatMessage, subscribeActivityChatMessages, ActivityChatMessage } from '../services/activityChat';
import { useAppState } from '../state/AppState';
import { formatDuration } from '../utils/time';
import { useI18n } from '../i18n/I18nProvider';

type Props = StackScreenProps<RootStackParamList, 'ActivityChat'>;

const chatErrorMessage = (error: unknown, isGerman: boolean, sending = false): string => {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'activity-chat/unauthenticated' || code === 'unauthenticated') {
    return isGerman ? 'Bitte melde dich erneut an, um den Chat zu nutzen.' : 'Please sign in again to use the chat.';
  }
  if (code === 'activity-chat/unavailable') {
    return isGerman ? 'Der Chat ist momentan nicht verfügbar. Bitte versuche es erneut.' : 'Chat is currently unavailable. Please try again.';
  }
  if (code === 'activity-chat/message-too-long') {
    return isGerman ? `Nachrichten dürfen höchstens ${ACTIVITY_CHAT_MESSAGE_MAX_LENGTH} Zeichen lang sein.` : `Messages can have at most ${ACTIVITY_CHAT_MESSAGE_MAX_LENGTH} characters.`;
  }
  return sending
    ? (isGerman ? 'Die Nachricht konnte nicht gesendet werden. Dein Text bleibt erhalten. Bitte versuche es erneut.' : 'Your message could not be sent. Your text has been kept. Please try again.')
    : (isGerman ? 'Der Chat konnte nicht verbunden werden. Bitte prüfe deine Verbindung und versuche es erneut.' : 'Could not connect to the chat. Please check your connection and try again.');
};

export const ActivityChatScreen: React.FC<Props> = ({ navigation, route }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { language } = useI18n();
  const insets = useSafeAreaInsets();
  const { state, actions } = useAppState();
  const [messages, setMessages] = useState<ActivityChatMessage[]>([]);
  const [threadTitle, setThreadTitle] = useState(route.params.title);
  const [composer, setComposer] = useState('');
  const [displayNameInput, setDisplayNameInput] = useState(state.prefs.chatDisplayName ?? '');
  const [expiresAtMs, setExpiresAtMs] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [connection, setConnection] = useState<'loading' | 'ready' | 'error'>('loading');
  const [connectionError, setConnectionError] = useState<unknown>(null);
  const [sendError, setSendError] = useState<unknown>(null);
  const [sending, setSending] = useState(false);
  const [retry, setRetry] = useState(0);
  const readyPromise = useRef<Promise<boolean> | null>(null);
  const ready = useRef(false);
  const expiry = useRef<number | null>(null);
  const sendPending = useRef(false);
  const mounted = useRef(false);
  const currentThreadId = useRef(route.params.threadId);
  const { threadId, title, expiresAt, suggestionId, regionLabel } = route.params;
  const isGerman = language === 'de';
  const displayName = normalizeActivityChatDisplayName(state.prefs.chatDisplayName ?? '');
  const needsDisplayName = !displayName;
  const expired = expiresAtMs !== null && expiresAtMs <= now;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    let cleanup: (() => void) | undefined;
    ready.current = false;
    setConnection('loading');
    setConnectionError(null);
    if (currentThreadId.current !== threadId) {
      currentThreadId.current = threadId;
      setMessages([]);
      setComposer('');
      setThreadTitle(title);
      setSendError(null);
      expiry.current = null;
      setExpiresAtMs(null);
    }
    const acceptThread = (thread: Awaited<ReturnType<typeof loadActivityChatThread>>) => {
      const timestamp = thread ? (thread.expiresAt?.toDate?.().getTime() ?? 0) : new Date(expiresAt).getTime();
      // A corrupt or expired stored date must never reopen an old conversation.
      expiry.current = Number.isFinite(timestamp) ? timestamp : 0;
      setExpiresAtMs(expiry.current);
      setNow(Date.now());
      if (thread?.title) setThreadTitle(thread.title);
      return expiry.current > Date.now();
    };
    const init = async () => {
      try {
        let thread = await loadActivityChatThread(threadId);
        if (!active) return false;
        if (!acceptThread(thread)) return false;
        if (!thread) {
          await ensureActivityChatThread({ threadId, title, expiresAt, suggestionId, regionLabel });
          if (!active) return false;
          // Another participant may have created this thread in the meantime.
          thread = await loadActivityChatThread(threadId);
          if (!active) return false;
          if (!thread) throw new Error('Activity chat thread is unavailable');
          if (!acceptThread(thread)) return false;
        }
        if (displayName) {
          await markActivityChatParticipant(threadId, displayName);
          if (!active) return false;
        }
        let listenerFailed = false;
        cleanup = subscribeActivityChatMessages(threadId, (nextMessages) => {
          if (active) setMessages(nextMessages);
        }, (error) => {
          if (!active) return;
          listenerFailed = true;
          ready.current = false;
          setConnection('error');
          setConnectionError(error);
        });
        if (!active) {
          cleanup();
          return false;
        }
        if (listenerFailed) return false;
        ready.current = true;
        setConnection('ready');
        return true;
      } catch (error) {
        if (active) {
          ready.current = false;
          setConnection('error');
          setConnectionError(error);
        }
        return false;
      }
    };

    readyPromise.current = init();
    return () => {
      active = false;
      ready.current = false;
      cleanup?.();
    };
  }, [displayName, threadId, title, expiresAt, suggestionId, regionLabel, retry, state.userId]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(interval);
  }, []);

  const remaining = Math.max(0, (expiresAtMs ?? now) - now);
  const remainingLabel = expiresAtMs === null ? '' : remaining > 0
    ? isGerman
      ? `${formatDuration(Math.ceil(remaining / 60000))} übrig`
      : `${formatDuration(Math.ceil(remaining / 60000))} left`
    : isGerman
      ? 'Abgelaufen'
      : 'Expired';

  const send = async () => {
    const body = composer.trim();
    if (!body || !displayName || sendPending.current) return;
    sendPending.current = true;
    setSending(true);
    setSendError(null);
    const initialization = readyPromise.current;
    try {
      if (!initialization || !await initialization || initialization !== readyPromise.current || !mounted.current || !ready.current) return;
      if (expiry.current === null || expiry.current <= Date.now()) {
        setNow(Date.now());
        return;
      }
      await sendActivityChatMessage(threadId, body, displayName);
      if (mounted.current && initialization === readyPromise.current) {
        setComposer(current => current === composer ? '' : current);
      }
    } catch (error) {
      if (mounted.current && initialization === readyPromise.current) setSendError(error);
    } finally {
      sendPending.current = false;
      if (mounted.current) setSending(false);
    }
  };

  const saveDisplayName = () => {
    const nextName = normalizeActivityChatDisplayName(displayNameInput);
    if (!nextName) return;
    actions.setPrefs({ ...state.prefs, chatDisplayName: nextName });
  };
  const sendDisabled = expired || connection !== 'ready' || sending || !composer.trim() || !displayName;

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + theme.spacing.md }]}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>{isGerman ? 'Zurück' : 'Back'}</Text>
        </Pressable>
        <Text style={styles.title}>{threadTitle}</Text>
        <Text style={styles.subtitle}>
          {isGerman ? 'Der Chat bleibt 24 Stunden offen.' : 'Chat stays open for 24 hours.'} {remainingLabel}
        </Text>
        {state.userId && (
          <Text style={styles.meta}>
            {isGerman ? 'Du chattest als ' : 'You are chatting as '}
            {displayName || (isGerman ? 'Name ausstehend' : 'name pending')}
          </Text>
        )}
      </View>

      <Modal visible={needsDisplayName && !expired} transparent animationType="fade" onRequestClose={() => navigation.goBack()}>
        <View style={styles.nameModalBackdrop}>
          <View style={styles.nameModalCard}>
            <Text style={styles.nameModalTitle}>{isGerman ? 'Wie sollen andere dich nennen?' : 'What should others call you?'}</Text>
            <Text style={styles.nameModalText}>
              {isGerman
                ? 'Dieser Name wird im Aktivitätschat angezeigt. Deine E-Mail-Adresse bleibt verborgen.'
                : 'This name is shown in activity chats. Your email address stays hidden.'}
            </Text>
            <TextInput
              value={displayNameInput}
              onChangeText={setDisplayNameInput}
              placeholder={isGerman ? 'z. B. Alex' : 'e.g. Alex'}
              placeholderTextColor={theme.colors.textMuted}
              style={styles.nameInput}
              autoCapitalize="words"
              maxLength={32}
            />
            <Pressable
              onPress={saveDisplayName}
              disabled={!displayNameInput.trim()}
              style={({ pressed }) => [styles.nameSaveButton, !displayNameInput.trim() && styles.nameSaveButtonDisabled, pressed && displayNameInput.trim() && { opacity: 0.88 }]}
            >
              <Text style={styles.nameSaveText}>{isGerman ? 'Chat beitreten' : 'Join chat'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.chatContent}>
        <ScrollView style={styles.messageScroll} contentContainerStyle={styles.messages} keyboardShouldPersistTaps="handled">
          {!expired && connection === 'loading' && (
            <Text style={styles.statusText} accessibilityLiveRegion="polite">{isGerman ? 'Chat wird verbunden …' : 'Connecting to chat…'}</Text>
          )}
          {!expired && connection === 'error' && (
            <View style={styles.emptyCard}>
              <Text style={styles.statusText} accessibilityRole="alert">{chatErrorMessage(connectionError, isGerman)}</Text>
              <Pressable accessibilityRole="button" onPress={() => setRetry(value => value + 1)} style={styles.retryButton}>
                <Text style={styles.sendBtnText}>{isGerman ? 'Erneut versuchen' : 'Try again'}</Text>
              </Pressable>
            </View>
          )}
          {expired && <Text style={styles.statusText}>{isGerman ? 'Dieser Chat ist abgelaufen.' : 'This chat has expired.'}</Text>}
          {messages.length === 0 && connection === 'ready' && !expired && (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>{isGerman ? 'Sag als Erste:r hallo' : 'Be the first to say hello'}</Text>
              <Text style={styles.emptyText}>
                {isGerman
                  ? 'Hier erscheinen Menschen, die zur gleichen Aktivität gehen.'
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

        <View style={[styles.composerWrap, { paddingBottom: Math.max(insets.bottom, theme.spacing.lg) }]}>
          {sendError !== null && <Text style={styles.sendError} accessibilityRole="alert">{chatErrorMessage(sendError, isGerman, true)}</Text>}
          <View style={styles.composerBar}>
            <TextInput
              value={composer}
              onChangeText={setComposer}
              placeholder={expired ? (isGerman ? 'Chat abgelaufen' : 'Chat expired') : (isGerman ? 'Schreib etwas' : 'Say something')}
              editable={!expired && !!displayName}
              placeholderTextColor={theme.colors.textMuted}
              style={styles.input}
              multiline
              maxLength={ACTIVITY_CHAT_MESSAGE_MAX_LENGTH}
            />
            <Pressable accessibilityRole="button" onPress={send} disabled={sendDisabled} style={({ pressed }) => [styles.sendBtn, sendDisabled && styles.sendBtnDisabled, pressed && !sendDisabled && { opacity: 0.85 }]}>
              <Text style={styles.sendBtnText}>{sending ? (isGerman ? 'Wird gesendet …' : 'Sending…') : (isGerman ? 'Senden' : 'Send')}</Text>
            </Pressable>
          </View>
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
  chatContent: { flex: 1 },
  messageScroll: { flex: 1 },
  statusText: { color: theme.colors.textMuted, fontFamily: theme.fonts.body, lineHeight: 20 },
  sendError: { color: theme.colors.text, fontFamily: theme.fonts.body, lineHeight: 20, marginBottom: theme.spacing.sm },
  retryButton: { alignSelf: 'flex-start', marginTop: theme.spacing.sm, backgroundColor: theme.colors.accent, borderRadius: theme.radius.md, paddingHorizontal: 14, paddingVertical: 10 },
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
  nameModalBackdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.42)', justifyContent: 'center', padding: theme.spacing.lg },
  nameModalCard: { backgroundColor: theme.colors.card, borderRadius: theme.radius.md, padding: theme.spacing.lg, borderWidth: 1, borderColor: theme.colors.border, gap: theme.spacing.md },
  nameModalTitle: { color: theme.colors.text, fontFamily: theme.fonts.heading, fontSize: 22 },
  nameModalText: { color: theme.colors.textMuted, fontFamily: theme.fonts.body, lineHeight: 20 },
  nameInput: { minHeight: 48, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, paddingHorizontal: 12, color: theme.colors.text, fontFamily: theme.fonts.body, backgroundColor: theme.colors.surface },
  nameSaveButton: { alignSelf: 'flex-start', backgroundColor: theme.colors.accent, borderRadius: theme.radius.sm, paddingHorizontal: 16, paddingVertical: 11 },
  nameSaveButtonDisabled: { opacity: 0.45 },
  nameSaveText: { color: theme.colors.accentText, fontFamily: theme.fonts.semibold },
});
