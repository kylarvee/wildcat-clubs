import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { ApiError, errorMessage } from '@/api/client';
import { Api } from '@/api/endpoints';
import type { CheckInVia, MCheckinPreview, MCheckinResult } from '@/api/types';
import { useSession } from '@/auth/session';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { CheckinResultView } from '@/components/CheckinResultView';
import { ClubLogo } from '@/components/ClubLogo';
import { Icon } from '@/components/Icon';
import { ScrollScreen } from '@/components/Screen';
import { ErrorView, InlineNotice, LoadingView } from '@/components/States';
import { Text } from '@/components/Text';
import { campusTime } from '@/lib/format';
import { dismissLive } from '@/lib/live-dismissals';
import { goBackOrHome, goHome } from '@/lib/nav';
import { invalidateApi } from '@/lib/use-api';
import { BRAND, space, useColors } from '@/theme';

type Params = { code: string; t?: string; auto?: string; via?: string };

/**
 * The check-in flow, for a scan, a typed code, the "check in?" pop-up or a
 * wildcatclubs://c/<code> link.
 *
 *  1. Preview (no side effects, works signed out). A live QR token comes back
 *     as a 10-minute pass, so the scan survives signing in.
 *  2. Signed out → sign in (Google creates the account on first use), then the
 *     check-in finishes on its own.
 *  3. Check in → the result: checked in, now a member, join request sent,
 *     progress toward a review.
 *
 * Scans and typed codes check in straight away (auto=1); a link opened from
 * outside the app waits for a tap, so a link alone never checks anyone in.
 */
export default function CheckinScreen() {
  const params = useLocalSearchParams<Params>();
  const code = String(params.code ?? '').toUpperCase();
  const via: CheckInVia = params.via === 'mobile-popup' ? 'mobile-popup' : 'mobile-scan';
  const { status, refreshMe } = useSession();

  const proof = useRef<string | null>(params.t ? String(params.t) : null);
  const wants = useRef(params.auto === '1');
  const attempted = useRef(false);
  const [preview, setPreview] = useState<MCheckinPreview | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [result, setResult] = useState<MCheckinResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const checkIn = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      const r = await Api.checkIn({ code, token: proof.current, via });
      setResult(r);
      // Done here: no more "check in?" prompts for this meeting.
      dismissLive(r.occurrence.id);
      invalidateApi();
      void refreshMe();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'UNAUTHENTICATED') wants.current = true;
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [code, via, refreshMe]);

  // Preview on arrival and again after signing in (the answer depends on who you are).
  useEffect(() => {
    if (status === 'loading' || !code) return;
    let cancelled = false;
    (async () => {
      setLoadError(null);
      try {
        const p = await Api.checkinPreview({ code, token: proof.current });
        if (cancelled) return;
        if (p.found && p.pass) proof.current = p.pass;
        setPreview(p);
        if (!p.found || status !== 'signedIn' || attempted.current) return;
        // Already on the list: show the details. Ready and asked for: go.
        if (p.existing || (p.ready && wants.current)) {
          attempted.current = true;
          await checkIn();
        }
      } catch (e) {
        if (!cancelled) setLoadError(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, status, attempt, checkIn]);

  const title = result ? 'Checked in' : 'Check in';

  if (result) {
    return (
      <ScrollScreen>
        <Stack.Screen options={{ title }} />
        <CheckinResultView
          result={result}
          onDone={goHome}
          onViewClub={result.club ? () => router.replace({ pathname: '/club/[slug]', params: { slug: result.club!.slug } }) : undefined}
        />
      </ScrollScreen>
    );
  }

  if (!preview) {
    return (
      <>
        <Stack.Screen options={{ title }} />
        {loadError ? <ErrorView error={loadError} onRetry={() => setAttempt((n) => n + 1)} /> : <LoadingView label="Looking up the event" />}
      </>
    );
  }

  const signedIn = status === 'signedIn';

  if (!preview.found) {
    // hidden: the code is real, but this viewer can't see the event yet. Signed out, signing
    // in may be enough (the preview re-runs and checks in on its own); signed in, it takes the
    // live QR at the event.
    const hidden = Boolean(preview.hidden);
    const signInFirst = hidden && !signedIn;
    return (
      <ScrollScreen>
        <Stack.Screen options={{ title }} />
        <View style={styles.notFound}>
          <Icon name="qr" size={44} color={BRAND} />
          <Text variant="title" style={styles.center} accessibilityRole="header">
            {!hidden ? `No event with code ${code}` : signedIn ? 'Scan the QR code at the event' : 'Sign in to check in'}
          </Text>
          <Text tone="ink2" style={styles.center}>
            {preview.message}
          </Text>
          {signInFirst ? (
            <Button
              title="Sign in to check in"
              icon="person"
              onPress={() => {
                wants.current = true;
                router.push({ pathname: '/welcome', params: { reason: 'checkin' } });
              }}
              style={styles.wide}
            />
          ) : null}
          <Button
            title={hidden && signedIn ? 'Scan the QR code' : 'Scan again'}
            icon="scan"
            variant={signInFirst ? 'ghost' : undefined}
            onPress={() => router.replace('/scan')}
            style={styles.wide}
          />
        </View>
      </ScrollScreen>
    );
  }

  const o = preview.occurrence;

  return (
    <ScrollScreen>
      <Stack.Screen options={{ title }} />
      <EventCard preview={preview} />

      {actionError ? <InlineNotice tone="danger">{actionError}</InlineNotice> : null}

      {!signedIn ? (
        <View style={styles.actions}>
          <Text tone="ink2">Sign in with your Weber State account to check in. New to Wildcat Clubs? Signing in creates your account — your scan is saved.</Text>
          <Button
            title="Sign in to check in"
            icon="person"
            onPress={() => {
              wants.current = true;
              router.push({ pathname: '/welcome', params: { reason: 'checkin', event: o.title } });
            }}
          />
        </View>
      ) : preview.blocker ? (
        <View style={styles.actions}>
          <InlineNotice tone="warning">{preview.blocker}</InlineNotice>
          {preview.scan === 'EXPIRED' ? <Button title="Scan the live code" icon="scan" onPress={() => router.replace('/scan')} /> : null}
          <Button title="Back" variant="ghost" onPress={goBackOrHome} />
        </View>
      ) : (
        <View style={styles.actions}>
          {preview.membership === 'REQUESTED' ? (
            <Text tone="ink2">Your join request is waiting on the club&apos;s leaders. Checking in still counts.</Text>
          ) : preview.membership === 'NONE' && o.club ? (
            <Text tone="ink2">Not a member of {o.club.name} yet? Checking in signs you up (or sends a join request if the club approves members).</Text>
          ) : null}
          <Button title="Check in" icon="checkCircle" onPress={() => void checkIn()} loading={busy} disabled={!preview.ready} />
          <Button title="Not now" variant="ghost" onPress={goBackOrHome} />
        </View>
      )}
    </ScrollScreen>
  );
}

function EventCard({ preview }: { preview: Extract<MCheckinPreview, { found: true }> }) {
  const c = useColors();
  const o = preview.occurrence;
  const host = o.club;
  const window =
    o.cancelled ? <Badge label="Cancelled" tone="danger" /> : o.windowState === 'OPEN' ? <Badge label="Check-in open" tone="success" /> : o.windowState === 'NOT_OPEN' ? <Badge label={`Opens ${campusTime(o.opensAt)}`} tone="warning" /> : <Badge label="Check-in closed" tone="neutral" />;
  return (
    <Card style={styles.card}>
      <View style={styles.host}>
        <ClubLogo name={host?.name ?? 'Weber State'} logoUrl={host?.logoUrl ?? null} color={host?.logoColor ?? BRAND} size={48} />
        <View style={styles.flex}>
          <Text variant="small" tone="ink2" numberOfLines={2}>
            {host?.name ?? 'Weber State University'}
            {o.cohosts.length ? ` with ${o.cohosts.map((x) => x.name).join(', ')}` : ''}
          </Text>
          {window}
        </View>
      </View>
      <Text variant="title" accessibilityRole="header">
        {o.title}
      </Text>
      <View style={styles.meta}>
        <Icon name="time" size={16} color={c.ink3} />
        <Text tone="ink2" style={styles.flex}>
          {o.whenLabel}
        </Text>
      </View>
      {o.place ? (
        <View style={styles.meta}>
          <Icon name="place" size={16} color={c.ink3} />
          <Text tone="ink2" style={styles.flex}>
            {o.place}
          </Text>
        </View>
      ) : null}
      {preview.scan === 'LIVE' ? (
        <View style={styles.meta}>
          <Icon name="checkCircle" size={16} color={c.success} />
          <Text variant="small" tone="success">
            QR code scanned
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 4 },
  card: { gap: space.sm, marginBottom: space.lg },
  host: { flexDirection: 'row', gap: space.md, alignItems: 'center', marginBottom: space.xs },
  meta: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  actions: { gap: space.md },
  notFound: { alignItems: 'center', gap: space.md, paddingTop: space.xxl },
  center: { textAlign: 'center' },
  wide: { alignSelf: 'stretch' },
});
