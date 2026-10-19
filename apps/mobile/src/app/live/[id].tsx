import { useEffect, useState } from 'react';
import { AppState, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import { ApiError } from '@/api/client';
import { Api } from '@/api/endpoints';
import type { MCheckinQr } from '@/api/types';
import { useSession } from '@/auth/session';
import { Button } from '@/components/Button';
import { ClubLogo } from '@/components/ClubLogo';
import { Icon, type IconName } from '@/components/Icon';
import { ProgressBar } from '@/components/ProgressBar';
import { QrCode } from '@/components/QrCode';
import { SignInPrompt } from '@/components/SignInPrompt';
import { LoadingView } from '@/components/States';
import { Text } from '@/components/Text';
import { campusTime } from '@/lib/format';
import { goBackOrHome } from '@/lib/nav';
import { MAX_WIDTH, radius, space, useColors } from '@/theme';

/**
 * The rotating check-in QR, full screen on a leader's phone, to hold up at
 * the door: the same token as the web's live screen. It changes every
 * rotateSeconds so a photo of it stops working, and the app fetches the next
 * one as each expires (and again on coming back to the app). The event code
 * sits under it for members of the host and co-host clubs to type. The
 * screen stays awake while it's open.
 */
export default function LiveQrScreen() {
  const { status, user } = useSession();
  const c = useColors();
  const insets = useSafeAreaInsets();
  // Opened cold (a link, a reload): wait for the stored sign-in before asking for the code.
  if (status === 'loading') return <LoadingView />;
  if (!user) {
    return (
      <View style={[styles.screen, { backgroundColor: c.background, paddingTop: insets.top }]}>
        <View style={styles.closeRow}>
          <Button title="Done" variant="ghost" compact onPress={goBackOrHome} />
        </View>
        <SignInPrompt icon="qr" title="Run check-in" body="Sign in as a club leader to show the check-in QR code from your phone." />
      </View>
    );
  }
  return <LiveQr />;
}

function LiveQr() {
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  useKeepAwake(undefined, { suppressDeactivateWarnings: true });
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const focused = useIsFocused();
  const appActive = useAppActive();
  const [qr, setQr] = useState<MCheckinQr | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  // Now, then each time the code expires. Paused under another screen (Add someone) and in the background.
  useEffect(() => {
    if (!focused || !appActive || fatal) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const next = await Api.checkinQr(String(id));
        if (cancelled) return;
        setQr(next);
        setReceivedAt(Date.now());
        setProblem(null);
        timer = setTimeout(() => void tick(), Math.max(next.refreshInMs + 250, 1000));
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && [400, 401, 403, 404].includes(e.status)) {
          setFatal(
            e.status === 401
              ? 'You were signed out. Sign in again to keep running check-in.'
              : e.status === 403
                ? `${e.message} Running check-in takes the Attendance permission in the host club.`
                : e.message,
          );
          return;
        }
        setProblem('Connection lost. Retrying… The last code keeps working for about a minute.');
        timer = setTimeout(() => void tick(), 5000);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id, focused, appActive, fatal]);

  const o = qr?.occurrence;
  const state = qr?.windowState;
  const side = Math.floor(Math.min(width - space.xl * 2, height * 0.46, 440));
  const banner: { tone: 'info' | 'warning' | 'danger'; icon: IconName; text: string } | null = fatal
    ? { tone: 'danger', icon: 'warning', text: fatal }
    : problem
      ? { tone: 'warning', icon: 'offline', text: problem }
      : o && state === 'NOT_OPEN'
        ? { tone: 'info', icon: 'time', text: `Check-in opens at ${campusTime(o.opensAt)}. Until then, scans say it hasn't opened yet.` }
        : o && state === 'CLOSED'
          ? { tone: 'warning', icon: 'time', text: `Check-in closed at ${campusTime(o.closesAt)}. You can still add people who were there with Add someone.` }
          : null;

  return (
    <View style={[styles.screen, { backgroundColor: c.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={[styles.bar, { borderBottomColor: c.line }]}>
        {o?.club ? <ClubLogo name={o.club.name} logoUrl={o.club.logoUrl} color={o.club.logoColor} size={34} /> : <Icon name="qr" size={28} color={c.brandText} />}
        <View style={styles.flex}>
          <Text variant="caption" tone="brand" numberOfLines={1}>
            {(o ? (o.club?.name ?? 'Weber State · WSUSA') : 'Check-in').toUpperCase()}
          </Text>
          <Text variant="label" numberOfLines={1} accessibilityRole="header">
            {o?.title ?? title ?? 'Check-in QR'}
          </Text>
        </View>
        <Button title="Done" variant="ghost" compact onPress={goBackOrHome} accessibilityHint="Closes the check-in screen" />
      </View>

      {banner ? <Banner {...banner} /> : null}

      {!qr && !fatal ? (
        <LoadingView label="Loading the check-in code" />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {qr && o ? (
            <>
              <View style={[styles.qrCard, { borderColor: c.line }]}>
                <QrCode rows={qr.qr} size={side} label={`QR code for checking in to ${o.title}`} dimmed={Boolean(fatal) || state === 'CLOSED'} />
              </View>
              <Countdown width={side} receivedAt={receivedAt} refreshInMs={qr.refreshInMs} rotateSeconds={qr.rotateSeconds} paused={Boolean(fatal || problem)} />
              <Text tone="ink2" style={styles.center}>
                Scan it with the Wildcat Clubs app or a phone&apos;s camera.
              </Text>

              {/* Typed codes only work for members of the host and co-host clubs, so only they are told to type it (as on the web). */}
              {qr.codeClubs ? (
                <View style={styles.codeBlock}>
                  <Text variant="small" tone="ink3" style={styles.center}>
                    Members of {qr.codeClubs} without a camera: in the app, tap Scan, then Enter code, and type
                  </Text>
                  <Text style={[styles.code, { color: c.ink }]} accessibilityLabel={`Code ${qr.code.split('').join(' ')}`} selectable maxFontSizeMultiplier={1.2}>
                    {qr.code.slice(0, 3)}
                    <Text style={{ color: c.ink3 }}>·</Text>
                    {qr.code.slice(3)}
                  </Text>
                </View>
              ) : null}
              <Text variant="small" tone="ink3" style={styles.center}>
                {[o.whenLabel, o.place].filter(Boolean).join(' · ')}
              </Text>

              <View style={[styles.count, { backgroundColor: c.brand }]} accessible accessibilityLabel={`${qr.checkedIn} checked in`} accessibilityLiveRegion="polite">
                <Icon name="clubs" size={30} color={c.onBrand} />
                <Text tone="onBrand" style={styles.countNumber} maxFontSizeMultiplier={1.2}>
                  {qr.checkedIn}
                </Text>
                <Text variant="label" tone="onBrand">
                  checked in
                </Text>
              </View>

              {state !== 'NOT_OPEN' && !fatal ? (
                <Button
                  title="Add someone"
                  icon="join"
                  variant="secondary"
                  onPress={() => router.push({ pathname: '/live/add/[id]', params: { id: o.id, title: o.title } })}
                  accessibilityHint="Checks in someone who can't scan"
                  style={styles.wide}
                />
              ) : null}
            </>
          ) : null}
          {fatal ? <Button title="Close" variant="secondary" onPress={goBackOrHome} style={styles.wide} /> : null}
        </ScrollView>
      )}
    </View>
  );
}

/** Whether the app is in the foreground (no polling in the background). */
function useAppActive() {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

/** A bar that empties until the code changes. */
function Countdown({ width, receivedAt, refreshInMs, rotateSeconds, paused }: { width: number; receivedAt: number; refreshInMs: number; rotateSeconds: number; paused: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const total = Math.max(1, rotateSeconds * 1000);
  const left = paused ? 0 : Math.max(0, Math.min(total, receivedAt + refreshInMs - now));
  return (
    <View style={[styles.countdown, { width }]}>
      <ProgressBar value={left / total} label={`The code changes every ${rotateSeconds} seconds`} />
    </View>
  );
}

function Banner({ tone, icon, text }: { tone: 'info' | 'warning' | 'danger'; icon: IconName; text: string }) {
  const c = useColors();
  const colors = { info: { bg: c.brandTint, fg: c.brandText }, warning: { bg: c.warningTint, fg: c.warning }, danger: { bg: c.dangerTint, fg: c.danger } }[tone];
  return (
    <View style={[styles.banner, { backgroundColor: colors.bg }]} accessibilityRole={tone === 'info' ? undefined : 'alert'}>
      <Icon name={icon} size={18} color={colors.fg} />
      <Text variant="small" style={[styles.flex, { color: colors.fg }]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  closeRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: space.lg, paddingVertical: space.sm },
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md },
  content: { alignItems: 'center', gap: space.md, padding: space.xl, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  qrCard: { padding: space.sm, borderRadius: radius.lg, borderWidth: 1, backgroundColor: '#ffffff' },
  countdown: { maxWidth: '100%' },
  center: { textAlign: 'center' },
  codeBlock: { alignItems: 'center', gap: space.xs, marginTop: space.xs },
  code: { fontSize: 44, lineHeight: 52, fontWeight: '800', letterSpacing: 6, fontVariant: ['tabular-nums'] },
  count: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderRadius: radius.lg, paddingHorizontal: space.xl, paddingVertical: space.md, marginTop: space.sm },
  countNumber: { fontSize: 40, lineHeight: 46, fontWeight: '800' },
  wide: { alignSelf: 'stretch' },
});
