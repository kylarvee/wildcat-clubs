import { useMemo, useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { errorMessage } from '@/api/client';
import { Api } from '@/api/endpoints';
import type { MCalendar, MEvent } from '@/api/types';
import { useSession } from '@/auth/session';
import { Button } from '@/components/Button';
import { EventRow } from '@/components/EventRow';
import { listContent } from '@/components/Screen';
import { SignInPrompt } from '@/components/SignInPrompt';
import { EmptyView, ErrorView, InlineNotice, LoadingView } from '@/components/States';
import { Text } from '@/components/Text';
import { campusDay } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { space, useColors } from '@/theme';

const WEEKS = 6;
/** The server's longest range (api/m calendarView); the whole range reloads on refresh. */
const MAX_DAYS = 400;

export default function CalendarScreen() {
  const { status, user } = useSession();
  if (status === 'loading') return <LoadingView />;
  if (!user) return <SignInPrompt icon="calendar" title="Your club calendar" body="Sign in to see every event from the clubs you follow, in one list." />;
  return <Agenda userId={user.id} />;
}

/** Your calendar as an agenda, grouped by day. Six weeks at a time; "Show more" reaches further. */
function Agenda({ userId }: { userId: string }) {
  const c = useColors();
  // How far "Show more" has reached, so a refresh reloads all of it rather than only the first six weeks.
  const [to, setTo] = useState<string | undefined>();
  const { data, error, loading, refreshing, refresh, reload, setData } = useApi(`calendar:${userId}`, () => Api.calendar(undefined, to));
  const [more, setMore] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  const sections = useMemo(() => {
    if (!data) return [];
    const byDay = new Map<string, { title: string; key: string; data: MEvent[] }>();
    for (const e of data.events) {
      const s = byDay.get(e.dayKey) ?? { title: e.dayLabel, key: e.dayKey, data: [] };
      s.data.push(e);
      byDay.set(e.dayKey, s);
    }
    return [...byDay.values()];
  }, [data]);

  if (loading && !data) return <LoadingView label="Loading your calendar" />;
  if (!data) return <ErrorView error={error} onRetry={reload} />;

  const today = todayKey();
  const nextTo = new Date(new Date(data.to).getTime() + WEEKS * 7 * 86_400_000).toISOString();
  const canLoadMore = new Date(nextTo).getTime() - new Date(data.from).getTime() <= MAX_DAYS * 86_400_000;

  const loadMore = async () => {
    setMore({ busy: true, error: null });
    try {
      const next: MCalendar = await Api.calendar(data.to, nextTo);
      setData((d) => {
        if (!d) return d;
        const seen = new Set(d.events.map((e) => e.occurrenceId));
        return { from: d.from, to: next.to, events: [...d.events, ...next.events.filter((e) => !seen.has(e.occurrenceId))] };
      });
      setTo(next.to);
      setMore({ busy: false, error: null });
    } catch (e) {
      setMore({ busy: false, error: errorMessage(e) });
    }
  };

  return (
    <SectionList
      style={{ backgroundColor: c.background }}
      sections={sections}
      keyExtractor={(e) => e.occurrenceId}
      contentContainerStyle={listContent}
      stickySectionHeadersEnabled
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.brandText} colors={[c.brand]} />}
      ListHeaderComponent={
        error ? (
          <View style={styles.pad}>
            <InlineNotice error={error} />
          </View>
        ) : undefined
      }
      renderSectionHeader={({ section }) => (
        <View style={[styles.dayHeader, { backgroundColor: c.background, borderBottomColor: c.line }]}>
          <Text variant="label" tone={section.key === today ? 'brand' : 'ink'} accessibilityRole="header">
            {section.key === today ? `Today · ${section.title}` : section.title}
          </Text>
        </View>
      )}
      renderItem={({ item }) => <EventRow event={item} showDate={false} onPress={() => router.push({ pathname: '/event/[id]', params: { id: item.occurrenceId } })} />}
      ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.line }]} />}
      ListEmptyComponent={
        <View style={styles.pad}>
          <EmptyView
            icon="calendar"
            title="Nothing on your calendar yet"
            body="Register for a club or subscribe to its calendar, and its events show up here."
            action="Browse clubs"
            onAction={() => router.push('/clubs')}
          />
        </View>
      }
      ListFooterComponent={
        <View style={styles.footer}>
          {more.error ? <InlineNotice tone="danger">{more.error}</InlineNotice> : null}
          <Text variant="small" tone="ink3" style={styles.center}>
            Showing through {campusDay(new Date(new Date(data.to).getTime() - 1).toISOString())}
          </Text>
          {canLoadMore ? <Button title={`Show ${WEEKS} more weeks`} variant="ghost" onPress={() => void loadMore()} loading={more.busy} /> : null}
        </View>
      }
    />
  );
}

/** Campus date "2026-10-16" for today. */
function todayKey() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

const styles = StyleSheet.create({
  pad: { padding: space.lg },
  dayHeader: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: space.lg + 16 },
  footer: { padding: space.lg, gap: space.sm },
  center: { textAlign: 'center' },
});
