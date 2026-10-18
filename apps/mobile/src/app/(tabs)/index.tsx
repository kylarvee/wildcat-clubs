import { Fragment } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Api } from '@/api/endpoints';
import type { MOccurrence } from '@/api/types';
import { useSession } from '@/auth/session';
import { AnnouncementCard } from '@/components/AnnouncementCard';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, Divider, Row, SectionHeader } from '@/components/Card';
import { ClubLogo } from '@/components/ClubLogo';
import { EventRow } from '@/components/EventRow';
import { LiveBanner } from '@/components/LiveBanner';
import { ScrollScreen } from '@/components/Screen';
import { EmptyView, ErrorView, InlineNotice, LoadingView } from '@/components/States';
import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { openWeb } from '@/lib/links';
import { dismissLive, useLiveDismissals } from '@/lib/live-dismissals';
import { useApi } from '@/lib/use-api';
import { radius, space, useColors } from '@/theme';

export default function HomeScreen() {
  const { status, user } = useSession();
  if (status === 'loading') return <LoadingView />;
  if (status === 'signedOut' || !user) return <SignedOutHome />;
  return <SignedInHome userId={user.id} />;
}

/** Signed out: what the app is for, and the three ways in. */
function SignedOutHome() {
  const c = useColors();
  return (
    <ScrollScreen>
      <View style={[styles.hero, { backgroundColor: c.brand }]}>
        <Text variant="display" tone="onBrand" accessibilityRole="header">
          Find your people at Weber State
        </Text>
        <Text tone="onBrand" style={styles.heroBody}>
          Join clubs, check in at meetings with one scan, and keep every club event on one calendar.
        </Text>
        <Button title="Sign in" variant="onBrand" icon="person" onPress={() => router.push('/welcome')} />
      </View>
      <View style={styles.ways}>
        <Card onPress={() => router.push('/scan')} accessibilityLabel="Scan a check-in code" accessibilityHint="Works before you sign in">
          <Text variant="label">At a club meeting?</Text>
          <Text tone="ink2">Scan the QR code on the screen. You can sign in right after — your scan is saved.</Text>
          <Text variant="label" tone="brand" style={styles.cta}>
            Scan to check in →
          </Text>
        </Card>
        <Card onPress={() => router.push('/clubs')} accessibilityLabel="Browse clubs">
          <Text variant="label">Looking for a club?</Text>
          <Text tone="ink2">Browse every Weber State club, from robotics to pickleball.</Text>
          <Text variant="label" tone="brand" style={styles.cta}>
            Browse clubs →
          </Text>
        </Card>
      </View>
    </ScrollScreen>
  );
}

function SignedInHome({ userId }: { userId: string }) {
  const { data, error, loading, refreshing, refresh, reload } = useApi(`home:${userId}`, Api.home, { staleMs: 20_000 });
  const dismissed = useLiveDismissals();
  const c = useColors();

  if (loading && !data) return <LoadingView label="Loading your clubs" />;
  if (!data) return <ErrorView error={error} onRetry={reload} />;

  const live = data.live.filter((o) => !dismissed.has(o.id));
  const checkIn = (o: MOccurrence) => router.push({ pathname: '/c/[code]', params: { code: o.code, auto: '1', via: 'mobile-popup' } });

  return (
    <ScrollScreen refreshing={refreshing} onRefresh={refresh}>
      {error ? <InlineNotice error={error} /> : null}
      <Text variant="display" accessibilityRole="header">
        Hi, {data.firstName}
      </Text>
      <Text tone="ink2" style={styles.lede}>
        {live.length ? 'One of your clubs is meeting right now.' : data.clubs.length ? "Here's what's coming up with your clubs." : 'Welcome to Wildcat Clubs.'}
      </Text>

      {live.map((o) => (
        <LiveBanner key={o.id} occurrence={o} onCheckIn={() => checkIn(o)} onDismiss={() => dismissLive(o.id)} />
      ))}

      {data.required.length ? (
        // What WSUSA requires sits above everything else; each opens on the web, where it's done.
        <Card style={[styles.flush, styles.required, { borderColor: c.danger }]}>
          <View style={[styles.requiredHead, { backgroundColor: c.dangerTint }]}>
            <Icon name="warning" size={18} color={c.danger} />
            <Text variant="label" style={{ color: c.danger }} accessibilityRole="header">
              Required by WSUSA
            </Text>
          </View>
          {data.required.map((t, i) => (
            <Fragment key={t.id}>
              {i ? <Divider /> : null}
              <Row onPress={() => void openWeb(t.path)} accessibilityLabel={`${t.title}. ${t.dueLabel ?? ''}. Opens on the web.`}>
                <View style={styles.flex}>
                  <Text variant="label">{t.title}</Text>
                  {t.dueLabel ? (
                    <Text variant="small" tone={t.overdue ? 'danger' : 'ink2'}>
                      {t.dueLabel}
                    </Text>
                  ) : null}
                </View>
                <Icon name="external" size={16} color={c.ink3} />
              </Row>
            </Fragment>
          ))}
        </Card>
      ) : null}

      <SectionHeader title="Your clubs" action="Browse all" onAction={() => router.push('/clubs')} />
      {data.clubs.length ? (
        <Card style={styles.flush}>
          {data.clubs.map((m, i) => (
            <Fragment key={m.club.id}>
              {i ? <Divider inset={68} /> : null}
              <Row onPress={() => router.push({ pathname: '/club/[slug]', params: { slug: m.club.slug } })} accessibilityLabel={`${m.club.name}, ${m.roleLabel ?? ''}`}>
                <ClubLogo name={m.club.name} logoUrl={m.club.logoUrl} color={m.club.logoColor} size={40} />
                <View style={styles.flex}>
                  <Text variant="label" numberOfLines={1}>
                    {m.club.name}
                  </Text>
                  {m.pending ? <Badge label="Request pending" tone="warning" /> : <Text variant="small" tone="ink2">{m.roleLabel}</Text>}
                </View>
              </Row>
            </Fragment>
          ))}
        </Card>
      ) : (
        <EmptyView icon="clubs" title="No clubs yet" body="Find one you like and tap Register — its events land on your calendar." action="Browse clubs" onAction={() => router.push('/clubs')} />
      )}

      <SectionHeader title="Coming up" action="Calendar" onAction={() => router.push('/calendar')} />
      {data.upcoming.length ? (
        <Card style={styles.flush}>
          {data.upcoming.map((e, i) => (
            <Fragment key={e.occurrenceId}>
              {i ? <Divider inset={80} /> : null}
              <EventRow event={e} onPress={() => router.push({ pathname: '/event/[id]', params: { id: e.occurrenceId } })} />
            </Fragment>
          ))}
        </Card>
      ) : (
        <EmptyView icon="calendar" title="Nothing in the next two weeks" body="Follow a club and its events show up here." />
      )}

      <SectionHeader title="Announcements" />
      {data.announcements.length ? (
        data.announcements.map((a) => (
          <AnnouncementCard key={a.id} item={a} onPress={a.club ? () => router.push({ pathname: '/club/[slug]', params: { slug: a.club!.slug } }) : undefined} />
        ))
      ) : (
        <Text tone="ink3" style={styles.quiet}>
          No announcements right now.
        </Text>
      )}
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.lg, padding: space.xl, gap: space.md },
  heroBody: { opacity: 0.92, marginBottom: space.sm },
  ways: { gap: space.md, marginTop: space.lg },
  cta: { marginTop: space.sm },
  lede: { marginTop: 2, marginBottom: space.lg },
  flush: { padding: 0, overflow: 'hidden' },
  required: { borderWidth: 1, marginBottom: space.lg },
  requiredHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md },
  flex: { flex: 1, gap: 2 },
  quiet: { paddingVertical: space.md },
});
