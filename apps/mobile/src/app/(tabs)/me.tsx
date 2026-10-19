import { Fragment, useCallback, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import { router, useFocusEffect } from 'expo-router';
import { Api } from '@/api/endpoints';
import type { MAttendanceItem, MClubAttendance } from '@/api/types';
import { useSession } from '@/auth/session';
import { API_URL } from '@/config';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, Divider, Row, SectionHeader } from '@/components/Card';
import { Avatar, ClubLogo } from '@/components/ClubLogo';
import { Icon } from '@/components/Icon';
import { ScrollScreen } from '@/components/Screen';
import { SignInPrompt } from '@/components/SignInPrompt';
import { EmptyView, ErrorView, InlineNotice, LoadingView } from '@/components/States';
import { Text } from '@/components/Text';
import { Toggle } from '@/components/Toggle';
import { confirmAsync } from '@/lib/confirm';
import { campusDay, pct, plural } from '@/lib/format';
import { openWeb } from '@/lib/links';
import { useApi } from '@/lib/use-api';
import { radius, space, useColors } from '@/theme';

const PAGE = 20;

export default function MeScreen() {
  const { status, user } = useSession();
  if (status === 'loading') return <LoadingView />;
  if (!user) {
    return (
      <ScrollScreen>
        <SignInPrompt icon="me" title="Your Wildcat Clubs" body="Sign in to see your attendance in every club, your roles, and your settings." />
        <WebRow />
        <AppInfo />
      </ScrollScreen>
    );
  }
  return <Me userId={user.id} />;
}

function Me({ userId }: { userId: string }) {
  const c = useColors();
  const { user, me, signOut, refreshMe } = useSession();
  const { data, error, loading, refreshing, refresh, reload } = useApi(`attendance:${userId}`, Api.attendance);
  const [club, setClub] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [signingOut, setSigningOut] = useState(false);

  const history = data ? data.history.filter((h) => !club || h.clubs.some((x) => x.id === club)) : [];
  const clubName = club ? data?.clubs.find((x) => x.club.id === club)?.club.name : null;

  const onSignOut = async () => {
    if (!(await confirmAsync('Sign out?', 'This phone stops getting your notifications until you sign in again.', 'Sign out', true))) return;
    setSigningOut(true);
    await signOut();
    setSigningOut(false);
    router.navigate('/');
  };

  return (
    <ScrollScreen
      refreshing={refreshing}
      onRefresh={() => {
        void refresh();
        void refreshMe();
      }}>
      {user ? (
        <View style={styles.profile}>
          <Avatar name={user.name} url={user.avatarUrl} color={user.avatarColor} size={64} />
          <View style={styles.flex}>
            <Text variant="title" accessibilityRole="header">
              {user.name}
            </Text>
            <Text variant="small" tone="ink2" numberOfLines={1}>
              {user.email}
            </Text>
            <View style={styles.badges}>
              <Badge label={user.status === 'ALUMNI' ? 'Alumni' : user.kind === 'STUDENT' ? 'Student' : 'Faculty & staff'} tone="brand" />
              {user.platformRole !== 'USER' ? <Badge label={user.platformRole === 'SYSADMIN' ? 'System admin' : 'WSUSA admin'} tone="neutral" /> : null}
            </View>
          </View>
        </View>
      ) : null}

      {me ? (
        <Card
          onPress={() => router.push('/tasks')}
          style={styles.tasks}
          accessibilityLabel={me.openTasks ? `Tasks: ${plural(me.openTasks, 'open task')}` : "Tasks: you're all caught up"}
          accessibilityHint="Approve requests, check off to-dos and see what WSUSA requires">
          <Icon name="tasks" size={22} color={c.brandText} />
          <View style={styles.flex}>
            <Text variant="label">Tasks</Text>
            <Text variant="small" tone="ink2">
              {me.openTasks ? `${plural(me.openTasks, 'open task')}: approvals, requirements and to-dos.` : "You're all caught up."}
            </Text>
          </View>
          {me.openTasks ? <Badge label={String(me.openTasks)} tone="brand" /> : null}
          <Icon name="chevron" size={16} color={c.ink3} />
        </Card>
      ) : null}

      {me?.roles.length ? (
        <>
          <SectionHeader title="Your roles" />
          <Card style={styles.flush}>
            {me.roles.map((r, i) => (
              <Fragment key={r.club.id}>
                {i ? <Divider inset={68} /> : null}
                <Row onPress={() => router.push({ pathname: '/club/[slug]', params: { slug: r.club.slug } })} accessibilityLabel={`${r.title} of ${r.club.name}`}>
                  <ClubLogo name={r.club.name} logoUrl={r.club.logoUrl} color={r.club.logoColor} size={36} />
                  <View style={styles.flex}>
                    <Text variant="label">{r.title}</Text>
                    <Text variant="small" tone="ink2" numberOfLines={1}>
                      {r.club.name} · since {campusDay(r.since)}
                    </Text>
                  </View>
                </Row>
              </Fragment>
            ))}
          </Card>
        </>
      ) : null}

      <SectionHeader title="Attendance" action="Full record" onAction={() => void openWeb('/me/attendance')} />
      {loading && !data ? (
        <LoadingView label="Loading your attendance" />
      ) : !data ? (
        <ErrorView error={error} onRetry={reload} />
      ) : (
        <>
          {error ? <InlineNotice error={error} /> : null}
          {data.totalCheckins === 0 && !data.clubs.length ? (
            <EmptyView icon="scan" title="No check-ins yet" body="Scan the QR code at your next club meeting and it shows up here." action="Scan to check in" onAction={() => router.push('/scan')} />
          ) : (
            <>
              <Text tone="ink2" style={styles.summary}>
                {plural(data.totalCheckins, 'check-in')} across {plural(data.clubs.length, 'club')}
                {data.more ? ' (showing the most recent)' : ''}.
              </Text>
              <View style={styles.clubCards}>
                {data.clubs.map((entry) => (
                  <ClubAttendanceCard key={entry.club.id} entry={entry} selected={club === entry.club.id} onPress={() => { setClub(club === entry.club.id ? null : entry.club.id); setShown(PAGE); }} />
                ))}
              </View>

              <SectionHeader title={clubName ? `Check-ins · ${clubName}` : 'Recent check-ins'} action={club ? 'Show all clubs' : undefined} onAction={club ? () => setClub(null) : undefined} />
              {history.length ? (
                <Card style={styles.flush}>
                  {history.slice(0, shown).map((h, i) => (
                    <Fragment key={h.id}>
                      {i ? <Divider inset={space.lg} /> : null}
                      <HistoryRow item={h} />
                    </Fragment>
                  ))}
                </Card>
              ) : (
                <Text tone="ink3">No check-ins in this list.</Text>
              )}
              {history.length > shown ? <Button title="Show more" variant="ghost" onPress={() => setShown((n) => n + PAGE)} style={styles.more} /> : null}
              {data.more && history.length <= shown ? <Button title="See everything on the web" variant="ghost" icon="external" onPress={() => void openWeb('/me/attendance')} style={styles.more} /> : null}
            </>
          )}
        </>
      )}

      <SectionHeader title="Settings" />
      <NotificationsSetting />
      <WebRow />
      <Button title="Sign out" variant="danger" icon="signOut" onPress={() => void onSignOut()} loading={signingOut} style={styles.signOut} />
      <AppInfo />
    </ScrollScreen>
  );
}

function ClubAttendanceCard({ entry, selected, onPress }: { entry: MClubAttendance; selected: boolean; onPress: () => void }) {
  const c = useColors();
  const s = entry.summary;
  const member = entry.membershipStatus === 'ACTIVE';
  // Never a member there (a guest visit) is the only "Guest"; every membership status says what it is.
  const label = member
    ? s.active
      ? 'Attending'
      : 'Member'
    : entry.membershipStatus === 'PENDING'
      ? 'Request pending'
      : entry.membershipStatus === 'DECLINED'
        ? 'Request declined'
        : entry.membershipStatus === 'REMOVED'
          ? 'Removed'
          : entry.membershipStatus === 'ALUMNI'
            ? 'Alumni'
            : entry.membershipStatus === 'LEFT'
              ? 'Left'
              : 'Guest';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${entry.club.name}. ${label}. ${plural(s.attended, 'event')} attended${member ? `, ${pct(s.rate)} attendance rate` : ''}.`}
      accessibilityHint={selected ? 'Shows check-ins from every club' : 'Shows only this club’s check-ins'}
      style={({ pressed }) => [styles.clubCard, { borderColor: selected ? c.brand : c.line, backgroundColor: pressed || selected ? c.brandTint : c.surface }]}>
      <View style={styles.clubHead}>
        <ClubLogo name={entry.club.name} logoUrl={entry.club.logoUrl} color={entry.club.logoColor} size={32} />
        <Text variant="label" numberOfLines={2} style={styles.flex}>
          {entry.club.name}
        </Text>
      </View>
      <View style={styles.clubFacts}>
        <Text variant="heading">{s.attended}</Text>
        <Text variant="small" tone="ink2">
          {s.attended === 1 ? 'event' : 'events'}
          {member && s.rate != null ? ` · ${pct(s.rate)}` : ''}
        </Text>
      </View>
      <Badge label={label} tone={member && s.active ? 'success' : label === 'Request pending' ? 'warning' : 'neutral'} />
    </Pressable>
  );
}

function HistoryRow({ item }: { item: MAttendanceItem }) {
  const host = item.clubs[0];
  return (
    <View style={styles.history} accessible accessibilityLabel={`${item.title}, ${item.dateLabel}, ${item.methodLabel}${host ? `, ${item.clubs.map((x) => x.name).join(' and ')}` : ''}${item.asMember === false ? ', as a guest' : ''}`}>
      <View style={styles.flex}>
        <Text variant="label" numberOfLines={2}>
          {item.title}
        </Text>
        <Text variant="small" tone="ink2" numberOfLines={1}>
          {host ? item.clubs.map((x) => x.name).join(' + ') : 'Weber State University'}
        </Text>
        <Text variant="caption" tone="ink3">
          {item.dateLabel} · {item.methodLabel}
        </Text>
      </View>
      {item.asMember === false ? <Badge label="Guest" tone="neutral" /> : null}
    </View>
  );
}

function NotificationsSetting() {
  const c = useColors();
  const { push, setPushEnabled, refreshPushStatus } = useSession();
  const [busy, setBusy] = useState(false);
  const on = push.kind === 'on';
  // The server's Push switch can change while the app is open: ask again when Me comes into view.
  useFocusEffect(
    useCallback(() => {
      void refreshPushStatus();
    }, [refreshPushStatus]),
  );
  const unavailable = push.kind === 'unavailable';
  const toggle = async (next: boolean) => {
    setBusy(true);
    await setPushEnabled(next);
    setBusy(false);
  };
  return (
    <Card style={styles.setting}>
      <View style={styles.settingRow}>
        <Icon name={on ? 'bell' : 'bellOff'} size={22} color={c.ink2} />
        <View style={styles.flex}>
          <Text variant="label">Push notifications on this phone</Text>
          <Text variant="small" tone="ink3">
            {/* "Reach this phone" only when they do: registered here AND the server's Push switch is on (System → AI & integrations). */}
            {on
              ? push.delivering
                ? 'Push notifications reach this phone: join approvals, announcements, event changes and reminders before events.'
                : "This phone is set up, but Wildcat Clubs isn't sending push notifications yet. Everything shows in the Notifications tab until then."
              : push.kind === 'denied'
                ? 'Notifications are blocked for Wildcat Clubs in your phone’s settings.'
                : unavailable
                  ? push.reason
                  : 'Off. The Notifications tab still updates.'}
          </Text>
        </View>
        <Toggle value={on} onValueChange={(v) => void toggle(v)} disabled={busy || unavailable || (push.kind === 'denied' && !push.canAskAgain)} accessibilityLabel="Push notifications on this phone" />
      </View>
      {push.kind === 'denied' && !push.canAskAgain ? <Button title="Open phone settings" variant="ghost" compact icon="external" onPress={() => void Linking.openSettings()} style={styles.alignStart} /> : null}
    </Card>
  );
}

function WebRow() {
  const c = useColors();
  return (
    <Card onPress={() => void openWeb('/dashboard')} style={styles.webRow} accessibilityLabel="Open Wildcat Clubs on the web" accessibilityHint="For leader tools, messages, tests, budgets and more">
      <Icon name="web" size={22} color={c.ink2} />
      <View style={styles.flex}>
        <Text variant="label">Open Wildcat Clubs on the web</Text>
        <Text variant="small" tone="ink3">
          Leader tools, messages, tests, budgets and more.
        </Text>
      </View>
      <Icon name="external" size={16} color={c.ink3} />
    </Card>
  );
}

function AppInfo() {
  return (
    <Text variant="caption" tone="ink3" style={styles.info}>
      Wildcat Clubs {Constants.expoConfig?.version ?? ''} · Weber State University{__DEV__ ? `\nServer: ${API_URL}` : ''}
    </Text>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  profile: { flexDirection: 'row', gap: space.lg, alignItems: 'center' },
  badges: { flexDirection: 'row', gap: space.xs, marginTop: space.xs, flexWrap: 'wrap' },
  tasks: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.lg },
  flush: { padding: 0, overflow: 'hidden' },
  summary: { marginBottom: space.md },
  clubCards: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  clubCard: { flexGrow: 1, flexBasis: 150, maxWidth: '100%', borderWidth: 1.5, borderRadius: radius.md, padding: space.md, gap: space.sm },
  clubHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  clubFacts: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  history: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  more: { marginTop: space.sm },
  setting: { gap: space.sm, marginBottom: space.sm },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  alignStart: { alignSelf: 'flex-start' },
  webRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.sm },
  signOut: { marginTop: space.md },
  info: { textAlign: 'center', marginTop: space.xl },
});
