import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { errorMessage } from '@/api/client';
import { Api } from '@/api/endpoints';
import type { MClubDetail, MOccurrence } from '@/api/types';
import { useSession } from '@/auth/session';

import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { Card, Divider, SectionHeader } from '@/components/Card';
import { CheckinSheet } from '@/components/CheckinSheet';
import { ClubLogo } from '@/components/ClubLogo';
import { EventRow } from '@/components/EventRow';
import { Icon } from '@/components/Icon';
import { ProgressBar } from '@/components/ProgressBar';
import { ScrollScreen } from '@/components/Screen';
import { EmptyView, ErrorView, InlineNotice, LoadingView } from '@/components/States';
import { Text } from '@/components/Text';
import { Toggle } from '@/components/Toggle';
import { confirmAsync } from '@/lib/confirm';
import { campusDay, pct, possessive } from '@/lib/format';
import { openWeb } from '@/lib/links';
import { dismissLive, useLiveDismissals } from '@/lib/live-dismissals';
import { invalidateApi, useApi } from '@/lib/use-api';
import { radius, space, useColors } from '@/theme';

type Notice = { tone: 'success' | 'info' | 'danger' | 'warning'; text: string } | null;

/** A club: who they are, Register / Follow, what's coming up, and your attendance. */
export default function ClubScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { user, status, refreshMe } = useSession();
  const c = useColors();
  const { data, error, loading, refreshing, refresh, reload, setData } = useApi(`club:${user?.id ?? 'anon'}:${slug}`, () => Api.club(String(slug)));
  const dismissed = useLiveDismissals();
  const [sheet, setSheet] = useState<MOccurrence | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [aboutOpen, setAboutOpen] = useState(false);

  // Members see the "check in?" pop-up when they open the page during an event — once; "Not now" sticks for this launch.
  const firstLive = data?.viewer.isMember ? (data.live.find((o) => !dismissed.has(o.id)) ?? null) : null;
  useEffect(() => {
    if (firstLive && !sheet) setSheet(firstLive);
  }, [firstLive, sheet]);

  const act = useCallback(
    async (action: 'join' | 'leave' | 'subscribe' | 'unsubscribe') => {
      if (!data) return;
      const { club, viewer } = data;
      setBusy(action);
      setNotice(null);
      try {
        const r = await Api.clubAction(club.slug, action);
        setData((d) => (d ? { ...d, viewer: r.viewer } : d));
        invalidateApi();
        if (action === 'join') {
          setNotice(
            r.joinStatus === 'PENDING' || r.joinStatus === 'ALREADY_PENDING'
              ? { tone: 'info', text: `Request pending. ${possessive(club.name)} leaders approve new members — you'll get a notification when they decide.` }
              : { tone: 'success', text: `You're in! Welcome to ${club.name}. Its events are on your calendar now.` },
          );
          void refresh();
        } else if (action === 'leave') {
          setNotice({ tone: 'info', text: viewer.isPending ? 'Your join request was withdrawn.' : `You left ${club.name}.` });
          void refresh();
        }
        void refreshMe();
      } catch (e) {
        setNotice({ tone: 'danger', text: errorMessage(e) });
      } finally {
        setBusy(null);
      }
    },
    [data, setData, refresh, refreshMe],
  );

  // "Sign in to register" registers too, once the signed-in answer is in (the web does this with ?register=1).
  // Back here still signed out means "Not now", which drops the wish.
  const wantsJoin = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!wantsJoin.current) return;
      if (status === 'signedOut') wantsJoin.current = false;
      else if (data?.viewer.signedIn) {
        wantsJoin.current = false;
        if (!data.viewer.isMember && !data.viewer.isPending) void act('join');
      }
    }, [status, data, act]),
  );

  if (loading && !data) return <LoadingView label="Loading club" />;
  if (!data) return (
    <>
      <Stack.Screen options={{ title: 'Club' }} />
      <ErrorView error={error} onRetry={reload} />
    </>
  );

  const club = data.club;
  const v = data.viewer;
  const retired = club.status === 'RETIRED';
  // Many clubs open their about text with an "About <club>" heading; the section already says so.
  const about = club.about.replace(new RegExp(`^about\\s+(us|${club.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\s*\\n`, 'i'), '').trim();
  const founding = club.status !== 'APPROVED' && !retired;
  // Activity standing, in the web's words; only shown when it isn't plain "Active".
  const m = data.metrics;
  const standing = !founding && !retired && m.hasMetrics ? (m.inPilot ? 'Pilot period' : !m.isActive ? 'Inactive' : null) : null;

  const signInToJoin = () => {
    wantsJoin.current = true;
    router.push({ pathname: '/welcome', params: { reason: 'register' } });
  };

  const leave = async () => {
    const pending = v.isPending;
    const ok = await confirmAsync(
      pending ? 'Withdraw your request?' : `Leave ${club.name}?`,
      pending ? "The club's leaders won't see it anymore. You can ask again later." : "You'll stop being a member and its events leave your calendar. Your attendance history stays.",
      pending ? 'Withdraw' : 'Leave club',
      true,
    );
    if (ok) await act('leave');
  };

  return (
    <ScrollScreen refreshing={refreshing} onRefresh={refresh}>
      <Stack.Screen options={{ title: club.name }} />
      {error ? <InlineNotice error={error} /> : null}

      <View style={styles.hero}>
        <ClubLogo name={club.name} logoUrl={club.logoUrl} color={club.logoColor} size={72} />
        <View style={styles.flex}>
          <Text variant="title" accessibilityRole="header">
            {club.name}
          </Text>
          <Text variant="small" tone="ink2">
            {[club.typeLabel, club.placement].join(' · ')}
          </Text>
          {club.focus ? (
            <Text variant="small" tone="ink3">
              {club.focus}
            </Text>
          ) : null}
          {standing ? <Badge label={standing} tone={standing === 'Inactive' ? 'warning' : 'neutral'} /> : null}
        </View>
      </View>
      {club.shortDescription ? <Text style={styles.short}>{club.shortDescription}</Text> : null}

      {retired ? <InlineNotice tone="info">This club is retired. Its history stays here for the record.</InlineNotice> : null}
      {founding ? <InlineNotice tone="info">This club is still being founded. It goes public once WSUSA approves it.</InlineNotice> : null}
      {notice ? <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice> : null}

      {/* Live check-in stays on the page after "Not now". */}
      {!sheet && v.isMember
        ? data.live.map((o) => (
            <Card key={o.id} style={[styles.liveRow, { borderColor: c.live }]}>
              <View style={styles.liveHead}>
                <Icon name="live" size={18} color={c.live} />
                <Text variant="label" tone="live">
                  Check-in is open
                </Text>
              </View>
              <Text variant="label">{o.title}</Text>
              <Button title="Check in" icon="checkCircle" compact onPress={() => setSheet(o)} style={styles.alignStart} />
            </Card>
          ))
        : null}

      {!retired && !founding ? (
        <Actions data={data} busy={busy} onSignIn={signInToJoin} onJoin={() => void act('join')} onLeave={() => void leave()} onToggleSubscribe={(on) => void act(on ? 'subscribe' : 'unsubscribe')} />
      ) : null}

      {data.attendance ? <AttendanceCard data={data} /> : null}

      {data.metrics.hasMetrics ? (
        <View style={styles.stats} accessibilityRole="summary">
          <Stat label="Attending" value={String(data.metrics.activeMembers)} hint="members" />
          <Stat label="Registered" value={String(data.metrics.registeredMembers)} hint="members" />
          <Stat label="Rating" value={data.metrics.avgRating != null && data.metrics.reviewCount ? `★ ${data.metrics.avgRating.toFixed(1)}` : '—'} hint={data.metrics.reviewCount ? `${data.metrics.reviewCount} reviews` : 'No reviews yet'} />
          <Stat label="Retention" value={pct(data.metrics.retentionRate)} hint="Month to month" />
        </View>
      ) : null}

      {!founding ? (
        <>
          <SectionHeader title="Coming up" />
          {data.upcoming.length ? (
            <Card style={styles.flush}>
              {data.upcoming.map((e, i) => (
                <Fragment key={e.occurrenceId}>
                  {i ? <Divider inset={80} /> : null}
                  <EventRow event={e} showClub={false} onPress={() => router.push({ pathname: '/event/[id]', params: { id: e.occurrenceId } })} />
                </Fragment>
              ))}
            </Card>
          ) : (
            <EmptyView icon="calendar" title={retired ? 'No more events' : 'Nothing scheduled yet'} body={retired ? undefined : "Follow the club to hear when something's on the calendar."} />
          )}
        </>
      ) : null}

      {about ? (
        <>
          <SectionHeader title="About" />
          <Text tone="ink2" numberOfLines={aboutOpen ? undefined : 8}>
            {about}
          </Text>
          {about.length > 400 ? (
            <Pressable onPress={() => setAboutOpen((o) => !o)} accessibilityRole="button" hitSlop={10} style={styles.more}>
              <Text variant="label" tone="brand">
                {aboutOpen ? 'Show less' : 'Read more'}
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : null}

      <SectionHeader title="Details" />
      <Card style={styles.details}>
        <Text variant="small" tone="ink3">
          Joining
        </Text>
        <Text>{club.joinPolicyLabel}</Text>
        {club.contactEmail ? (
          <>
            <Text variant="small" tone="ink3" style={styles.detailLabel}>
              Contact
            </Text>
            <Pressable onPress={() => void Linking.openURL(`mailto:${club.contactEmail}`)} accessibilityRole="link" accessibilityLabel={`Email ${club.contactEmail}`}>
              <Text tone="brand">{club.contactEmail}</Text>
            </Pressable>
          </>
        ) : null}
      </Card>
      <Button title="Open the full club page on the web" variant="ghost" icon="external" onPress={() => void openWeb(club.webPath)} style={styles.web} accessibilityHint="Org chart, reviews, resources and more" />

      {sheet ? (
        <CheckinSheet
          occurrence={sheet}
          onClose={(checkedIn) => {
            dismissLive(sheet.id);
            setSheet(null);
            if (checkedIn) void refresh();
          }}
          onCheckedIn={() => {
            invalidateApi();
            void refreshMe();
          }}
        />
      ) : null}
    </ScrollScreen>
  );
}

function Actions({ data, busy, onSignIn, onJoin, onLeave, onToggleSubscribe }: { data: MClubDetail; busy: string | null; onSignIn: () => void; onJoin: () => void; onLeave: () => void; onToggleSubscribe: (on: boolean) => void }) {
  const c = useColors();
  const v = data.viewer;
  const club = data.club;
  if (!v.signedIn) {
    return (
      <View style={styles.actions}>
        <Button
          title={club.joinPolicy === 'APPROVAL' ? 'Sign in to request to join' : 'Sign in to register'}
          icon="join"
          onPress={onSignIn}
        />
        <Text variant="small" tone="ink3">
          Use your Weber State account. Signing in for the first time creates it.
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.actions}>
      {v.isMember ? (
        <View style={[styles.memberRow, { backgroundColor: c.brandTint }]}>
          <Icon name="checkCircle" size={22} color={c.brandText} />
          <View style={styles.flex}>
            <Text variant="label" tone="brand">
              {v.isLeader && v.roleLabel ? v.roleLabel : "You're a member"}
            </Text>
            {v.isLeader ? (
              <Text variant="small" tone="ink2">
                Leader tools are on the web.
              </Text>
            ) : null}
          </View>
          {v.role !== 'ADVISOR' ? <Button title="Leave" variant="danger" compact onPress={onLeave} loading={busy === 'leave'} /> : null}
        </View>
      ) : v.isPending ? (
        <View style={[styles.memberRow, { backgroundColor: c.warningTint }]}>
          <Icon name="pending" size={22} color={c.warning} />
          <View style={styles.flex}>
            <Text variant="label" tone="warning">
              Request pending
            </Text>
            <Text variant="small" tone="ink2">
              The club&apos;s leaders will review it.
            </Text>
          </View>
          <Button title="Withdraw" variant="danger" compact onPress={onLeave} loading={busy === 'leave'} />
        </View>
      ) : (
        <>
          <Button title={club.joinPolicy === 'APPROVAL' ? 'Request to join' : 'Register'} icon="join" onPress={onJoin} loading={busy === 'join'} />
          <Text variant="small" tone="ink3">
            {club.joinPolicy === 'APPROVAL' ? "Leaders approve new members. You'll get a notification when they decide." : "You'll join right away, and its events go on your calendar."}
          </Text>
        </>
      )}
      <View style={[styles.switchRow, { borderColor: c.line }]}>
        <Icon name="subscribe" size={22} color={c.ink2} />
        <View style={styles.flex}>
          <Text variant="label" nativeID="sub-label">
            Follow this calendar
          </Text>
          <Text variant="small" tone="ink3">
            {v.subscribed ? 'Following — its events are on your calendar.' : v.isMember ? "Not following — its events aren't on your calendar." : 'See its events on your calendar without joining.'}
          </Text>
        </View>
        <Toggle value={v.subscribed} onValueChange={onToggleSubscribe} disabled={busy === 'subscribe' || busy === 'unsubscribe'} accessibilityLabel={`Follow ${possessive(club.name)} calendar`} />
      </View>
    </View>
  );
}

function AttendanceCard({ data }: { data: MClubDetail }) {
  const a = data.attendance!;
  const member = data.viewer.isMember;
  return (
    <>
      <SectionHeader title="Your attendance" />
      <Card style={styles.attendance}>
        {a.attended === 0 ? (
          <Text tone="ink2">You haven&apos;t checked in yet. Scan the QR code at the next meeting.</Text>
        ) : (
          <View style={styles.statsRow}>
            <Stat label="Events" value={String(a.attended)} style={styles.third} />
            <Stat label="Rate" value={member ? pct(a.rate) : '—'} hint={member && a.heldSinceJoined ? `of ${a.heldSinceJoined} held` : undefined} style={styles.third} />
            <Stat label="Status" value={member ? (a.active ? 'Attending' : 'Not attending lately') : data.viewer.isPending ? 'Request pending' : 'Guest'} style={styles.third} />
          </View>
        )}
        {a.lastAttendedAt ? (
          <Text variant="small" tone="ink3">
            Last event {campusDay(a.lastAttendedAt)}
          </Text>
        ) : null}
        {/* Only active students review clubs; alumni and faculty/staff see no review row. */}
        {!a.canReview ? null : a.reviewEligible ? (
          <Button title="Leave a review" variant="secondary" icon="star" compact onPress={() => void openWeb(`${data.club.webPath}#reviews`)} style={styles.alignStart} />
        ) : (
          <View style={styles.review}>
            <Text variant="small" tone="ink2">
              {a.attended} of {a.reviewThreshold} events toward leaving a review
            </Text>
            <ProgressBar value={a.attended / Math.max(1, a.reviewThreshold)} label={`${a.attended} of ${a.reviewThreshold} events toward leaving a review`} />
          </View>
        )}
      </Card>
    </>
  );
}

function Stat({ label, value, hint, style }: { label: string; value: string; hint?: string; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return (
    <View style={[styles.stat, { backgroundColor: c.surfaceAlt }, style]} accessible accessibilityLabel={`${label}: ${value}${hint ? `, ${hint}` : ''}`}>
      <Text variant="caption" tone="ink3" numberOfLines={1}>
        {label.toUpperCase()}
      </Text>
      {/* Two lines, so "Not attending lately" fits a third of a phone screen. */}
      <Text variant="heading" numberOfLines={2}>
        {value}
      </Text>
      {hint ? (
        <Text variant="caption" tone="ink3" numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  hero: { flexDirection: 'row', gap: space.lg, alignItems: 'center' },
  short: { marginTop: space.md, marginBottom: space.sm },
  liveRow: { gap: space.xs, marginTop: space.md, borderWidth: 1.5 },
  liveHead: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  alignStart: { alignSelf: 'flex-start', marginTop: space.xs },
  actions: { gap: space.sm, marginTop: space.lg },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 64 },
  attendance: { gap: space.md },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.lg },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  third: { flexBasis: '28%', padding: space.sm + 2 },
  stat: { flexGrow: 1, flexBasis: '40%', borderRadius: radius.md, padding: space.md, gap: 2 },
  review: { gap: space.sm },
  flush: { padding: 0, overflow: 'hidden' },
  more: { marginTop: space.sm, minHeight: 32, justifyContent: 'center' },
  details: { gap: 2 },
  detailLabel: { marginTop: space.md },
  web: { marginTop: space.lg },
});
