import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { errorMessage } from '@/api/client';
import { Api } from '@/api/endpoints';
import type { MPersona, MSession } from '@/api/types';
import { useSession } from '@/auth/session';
import { googleClientIdForPlatform } from '@/config';
import { Avatar } from '@/components/ClubLogo';
import { Button } from '@/components/Button';
import { Card, Divider } from '@/components/Card';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';
import { Icon } from '@/components/Icon';
import { ScrollScreen } from '@/components/Screen';
import { ErrorView, InlineNotice, LoadingView } from '@/components/States';
import { Text } from '@/components/Text';
import { useApi } from '@/lib/use-api';
import { radius, space, useColors } from '@/theme';

const GROUP_ORDER = ['Students', 'Faculty & staff', 'Administration'];

function close() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/**
 * Welcome / sign in. Weber State Google when this build and the server are set
 * up for it; test personas while the server allows them. A first Google
 * sign-in creates the account, like on the web.
 */
export default function WelcomeScreen() {
  const c = useColors();
  const { reason, event } = useLocalSearchParams<{ reason?: string; event?: string }>();
  const { signIn } = useSession();
  const options = useApi('auth-options', Api.authOptions, { staleMs: 60_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finish = useCallback(
    async (start: () => Promise<MSession>, key: string) => {
      setBusy(key);
      setError(null);
      try {
        await signIn(await start());
        close();
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(null);
      }
    },
    [signIn],
  );

  const onIdToken = useCallback((idToken: string) => void finish(() => Api.signInGoogle(idToken), 'google'), [finish]);
  const onGoogleError = useCallback((m: string) => setError(m), []);

  const data = options.data;
  const googleHere = Boolean(data?.googleEnabled && googleClientIdForPlatform());
  const groups = GROUP_ORDER.map((g) => ({ group: g, people: (data?.personas ?? []).filter((p) => p.group === g) })).filter((g) => g.people.length);

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: c.background }]} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Not now" hitSlop={12} style={styles.closeButton}>
          <Text variant="label" tone="brand">
            Not now
          </Text>
        </Pressable>
      </View>
      <ScrollScreen>
        <View style={styles.brand}>
          <Image source={require('@/assets/images/icon.png')} style={styles.logo} accessibilityIgnoresInvertColors accessible={false} />
          <Text variant="display" style={styles.center} accessibilityRole="header">
            Wildcat Clubs
          </Text>
          <Text tone="ink2" style={styles.center}>
            Sign in with your Weber State account to join clubs, check in at meetings and keep your club calendar.
          </Text>
        </View>

        {reason === 'checkin' ? (
          <InlineNotice tone="info">
            {event ? `Sign in to finish checking in to ${event}` : 'Sign in to finish checking in'} — we&apos;ll take you right back. New here? Signing in creates your account.
          </InlineNotice>
        ) : reason === 'register' ? (
          <InlineNotice tone="info">Sign in to register. New here? Signing in creates your account.</InlineNotice>
        ) : null}

        {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}

        {options.loading && !data ? (
          <LoadingView label="Loading sign-in options" />
        ) : !data ? (
          <ErrorView error={options.error} onRetry={options.reload} />
        ) : (
          <View style={styles.methods}>
            {googleHere ? (
              <>
                <GoogleSignInButton onIdToken={onIdToken} onError={onGoogleError} busy={busy === 'google'} />
                <Text variant="small" tone="ink3" style={styles.center}>
                  Students use @mail.weber.edu; faculty and staff use @weber.edu.
                </Text>
              </>
            ) : null}

            {groups.length ? (
              <View style={styles.personas}>
                <View style={styles.personaHead}>
                  <Icon name="info" size={18} color={c.ink3} />
                  <Text variant="small" tone="ink2" style={styles.flex}>
                    This is a test server. Pick a test persona to see the app as them — each has a ready-made history.
                  </Text>
                </View>
                {groups.map(({ group, people }) => (
                  <View key={group} style={styles.group}>
                    <Text variant="caption" tone="ink3" style={styles.groupTitle} accessibilityRole="header">
                      {group.toUpperCase()}
                    </Text>
                    <Card style={styles.flush}>
                      {people.map((p, i) => (
                        <View key={p.key}>
                          {i ? <Divider inset={68} /> : null}
                          <PersonaRow persona={p} busy={busy === p.key} disabled={busy !== null} onPress={() => void finish(() => Api.signInPersona(p.key), p.key)} />
                        </View>
                      ))}
                    </Card>
                  </View>
                ))}
              </View>
            ) : null}

            {!googleHere && !groups.length ? (
              <View style={[styles.unavailable, { borderColor: c.line }]}>
                <Text variant="heading">Sign-in isn&apos;t ready on this server</Text>
                <Text tone="ink2">
                  {data.googleEnabled
                    ? 'Weber State Google sign-in needs to be set up for this version of the app. You can still scan check-in codes and browse clubs.'
                    : "Sign-in hasn't been turned on yet. You can still browse clubs."}
                </Text>
                <Button title="Browse clubs" variant="secondary" onPress={() => router.replace('/clubs')} />
              </View>
            ) : null}
          </View>
        )}
      </ScrollScreen>
    </SafeAreaView>
  );
}

function PersonaRow({ persona, busy, disabled, onPress }: { persona: MPersona; busy: boolean; disabled: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={`Sign in as ${persona.name}, ${persona.label}`}
      accessibilityHint={persona.blurb}
      accessibilityState={{ disabled, busy }}
      style={({ pressed }) => [styles.persona, pressed && { backgroundColor: c.surfaceAlt }, disabled && !busy && { opacity: 0.6 }]}>
      <Avatar name={persona.name} url={null} color={c.brand} size={40} />
      <View style={styles.flex}>
        <Text variant="label">{persona.name}</Text>
        <Text variant="small" tone="brand">
          {persona.label}
        </Text>
        <Text variant="small" tone="ink2" numberOfLines={2}>
          {persona.blurb}
        </Text>
      </View>
      {busy ? <Text variant="small" tone="ink3">Signing in…</Text> : <Icon name="chevron" size={16} color={c.ink3} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topBar: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: space.lg, paddingTop: space.sm },
  closeButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.sm },
  brand: { alignItems: 'center', gap: space.sm, marginBottom: space.xl },
  logo: { width: 72, height: 72, borderRadius: radius.lg, marginBottom: space.sm },
  center: { textAlign: 'center' },
  methods: { gap: space.md },
  personas: { gap: space.md, marginTop: space.sm },
  personaHead: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  group: { gap: space.xs },
  groupTitle: { letterSpacing: 0.8, marginLeft: space.xs },
  flush: { padding: 0, overflow: 'hidden' },
  persona: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, minHeight: 64 },
  unavailable: { gap: space.sm, padding: space.lg, borderWidth: 1, borderRadius: radius.lg, borderStyle: 'dashed' },
});
