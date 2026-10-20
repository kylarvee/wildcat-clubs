import { Fragment, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, SectionList, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { errorMessage } from '@/api/client';
import { Api } from '@/api/endpoints';
import type { MCalendar, MEvent, MEventFilter } from '@/api/types';
import { useSession } from '@/auth/session';
import { Button } from '@/components/Button';
import { Divider } from '@/components/Card';
import { EventRow } from '@/components/EventRow';
import { addMonths, dateKey, MonthCalendar } from '@/components/MonthCalendar';
import { listContent } from '@/components/Screen';
import { SignInPrompt } from '@/components/SignInPrompt';
import { EmptyView, ErrorView, InlineNotice, LoadingView } from '@/components/States';
import { Text } from '@/components/Text';
import { campusDay } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { radius, space, useColors } from '@/theme';

const WEEKS = 6;
/** The server's longest range (api/m events); the whole range reloads on refresh. */
const MAX_DAYS = 400;
const DAY_MS = 86_400_000;

type Mode = 'list' | 'calendar';

/** One filter at a time, as on the web Events page. "Following" is your calendar: the clubs you follow (and university events if you keep them on). */
const FILTERS: { key: MEventFilter; label: string; a11y: string }[] = [
  { key: 'all', label: 'All', a11y: 'All events' },
  { key: 'free-food', label: 'Free food', a11y: 'Events with free food' },
  { key: 'service', label: 'Service hours', a11y: 'Events that count toward service hours' },
  { key: 'following', label: 'Following', a11y: 'Events from clubs you follow' },
];

const EMPTY: Record<MEventFilter, { title: string; body: string }> = {
  all: { title: 'Nothing on the calendar yet', body: 'When clubs add events, they show up here.' },
  'free-food': { title: 'No free food coming up', body: 'Nothing in this stretch offers free food yet. Check back soon.' },
  service: { title: 'No service hours coming up', body: 'Nothing in this stretch counts toward service hours yet.' },
  following: { title: 'Nothing from the clubs you follow', body: 'Register for a club or follow it, and its events show up here.' },
};

/** Campus date "2026-10-16" for today. */
function todayKey() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** "Tuesday, Oct 20" for a campus date key. */
function longDay(key: string) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${key}T12:00:00Z`));
}

function byDay(events: MEvent[] | undefined) {
  const map = new Map<string, MEvent[]>();
  for (const e of events ?? []) map.set(e.dayKey, [...(map.get(e.dayKey) ?? []), e]);
  return map;
}

const openEvent = (e: MEvent) => router.push({ pathname: '/event/[id]', params: { id: e.occurrenceId } });

/**
 * Events: what's on at Weber State, as a list or a month calendar, with the
 * web Events page's filters (All, Free food, Service hours, Following). Works
 * signed out; Following needs an account.
 */
export default function EventsScreen() {
  const c = useColors();
  const { status, user } = useSession();
  const [mode, setMode] = useState<Mode>('list');
  const [filter, setFilter] = useState<MEventFilter>('all');
  if (status === 'loading') return <LoadingView />;
  const userId = user?.id ?? null;
  return (
    <View style={[styles.flex, { backgroundColor: c.background }]}>
      <Controls mode={mode} onMode={setMode} filter={filter} onFilter={setFilter} />
      {filter === 'following' && !user ? (
        <SignInPrompt icon="star" title="Events from clubs you follow" body="Sign in to see your calendar: the clubs you follow, members-only events included." />
      ) : mode === 'list' ? (
        <EventList key={`${filter}:${userId}`} filter={filter} userId={userId} />
      ) : (
        <EventMonth filter={filter} userId={userId} />
      )}
    </View>
  );
}

function Controls({ mode, onMode, filter, onFilter }: { mode: Mode; onMode: (m: Mode) => void; filter: MEventFilter; onFilter: (f: MEventFilter) => void }) {
  const c = useColors();
  return (
    <View style={[styles.controls, { borderBottomColor: c.line }]}>
      <View style={[styles.segment, { backgroundColor: c.surfaceAlt }]}>
        {(['list', 'calendar'] as const).map((m) => (
          <Pressable
            key={m}
            onPress={() => onMode(m)}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === m }}
            accessibilityLabel={m === 'list' ? 'Show as a list' : 'Show as a calendar'}
            style={[styles.segmentItem, mode === m && { backgroundColor: c.surface, borderColor: c.line }]}>
            <Text variant="label" tone={mode === m ? 'ink' : 'ink3'}>
              {m === 'list' ? 'List' : 'Calendar'}
            </Text>
          </Pressable>
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {FILTERS.map((f) => {
          const on = filter === f.key;
          return (
            <Pressable
              key={f.key}
              onPress={() => onFilter(f.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={f.a11y}
              style={[styles.chip, { borderColor: on ? c.brandText : c.line, backgroundColor: on ? c.brandTint : c.surface }]}>
              <Text variant="small" tone={on ? 'brand' : 'ink2'} style={on ? styles.chipOn : undefined}>
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** The list: grouped by day, six weeks at a time; "Show more" reaches further. */
function EventList({ filter, userId }: { filter: MEventFilter; userId: string | null }) {
  const c = useColors();
  // How far "Show more" has reached, so a refresh reloads all of it rather than only the first six weeks.
  const [to, setTo] = useState<string | undefined>();
  const { data, error, loading, refreshing, refresh, reload, setData } = useApi(`events:${userId ?? 'anon'}:${filter}`, () => Api.events(filter, undefined, to));
  const [more, setMore] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  const sections = useMemo(() => [...byDay(data?.events).entries()].map(([key, items]) => ({ key, title: items[0].dayLabel, data: items })), [data]);

  if (loading && !data) return <LoadingView label="Loading events" />;
  if (!data) return <ErrorView error={error} onRetry={reload} />;

  const today = todayKey();
  const nextTo = new Date(new Date(data.to).getTime() + WEEKS * 7 * DAY_MS).toISOString();
  const canLoadMore = new Date(nextTo).getTime() - new Date(data.from).getTime() <= MAX_DAYS * DAY_MS;

  const loadMore = async () => {
    setMore({ busy: true, error: null });
    try {
      const next: MCalendar = await Api.events(filter, data.to, nextTo);
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
      renderItem={({ item }) => <EventRow event={item} showDate={false} showCover onPress={() => openEvent(item)} />}
      ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.line }]} />}
      ListEmptyComponent={
        <View style={styles.pad}>
          <EmptyView
            icon="calendar"
            title={EMPTY[filter].title}
            body={EMPTY[filter].body}
            action={filter === 'following' ? 'Browse clubs' : undefined}
            onAction={filter === 'following' ? () => router.push('/clubs') : undefined}
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

/** The calendar: a month grid with a dot per event; the chosen day's events below it. */
function EventMonth({ filter, userId }: { filter: MEventFilter; userId: string | null }) {
  const c = useColors();
  const today = todayKey();
  const [ty, tm] = today.split('-').map(Number);
  const [ym, setYm] = useState({ y: ty, m: tm });
  const [selected, setSelected] = useState(today);
  // A day either side, so every campus day of the month is covered whatever the offset from UTC.
  const from = new Date(Date.UTC(ym.y, ym.m - 1, 1) - DAY_MS).toISOString();
  const to = new Date(Date.UTC(ym.y, ym.m, 1) + 2 * DAY_MS).toISOString();
  const { data, error, loading, refreshing, refresh, reload } = useApi(`events-month:${userId ?? 'anon'}:${filter}:${ym.y}-${ym.m}`, () => Api.events(filter, from, to), { keepPrevious: true });
  const days = useMemo(() => byDay(data?.events), [data]);
  const dayEvents = days.get(selected) ?? [];

  const changeMonth = (delta: number) => {
    const n = addMonths(ym.y, ym.m, delta);
    setYm(n);
    setSelected(n.y === ty && n.m === tm ? today : dateKey(n.y, n.m, 1));
  };

  return (
    <ScrollView
      style={{ backgroundColor: c.background }}
      contentContainerStyle={[listContent, styles.month]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.brandText} colors={[c.brand]} />}>
      {error ? data ? <InlineNotice error={error} /> : <ErrorView error={error} onRetry={reload} /> : null}
      <MonthCalendar year={ym.y} month={ym.m} eventsByDay={days} selected={selected} today={today} onSelect={setSelected} onChangeMonth={changeMonth} />
      <Text variant="heading" accessibilityRole="header" style={styles.dayTitle}>
        {selected === today ? `Today · ${longDay(selected)}` : longDay(selected)}
      </Text>
      {loading && !data ? (
        <LoadingView label="Loading events" />
      ) : dayEvents.length ? (
        <View style={[styles.dayList, { borderColor: c.line, backgroundColor: c.surface }]}>
          {dayEvents.map((e, i) => (
            <Fragment key={e.occurrenceId}>
              {i ? <Divider inset={space.lg + 16} /> : null}
              <EventRow event={e} showDate={false} showCover onPress={() => openEvent(e)} />
            </Fragment>
          ))}
        </View>
      ) : (
        <Text tone="ink3">{filter === 'all' ? 'Nothing on this day.' : 'Nothing on this day with this filter.'}</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  controls: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.sm, gap: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  segment: { flexDirection: 'row', borderRadius: radius.md, padding: 3, alignSelf: 'flex-start' },
  segmentItem: { minHeight: 36, paddingHorizontal: space.lg, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: 'transparent' },
  chips: { gap: space.sm, paddingRight: space.lg },
  chip: { minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  chipOn: { fontWeight: '600' },
  pad: { padding: space.lg },
  dayHeader: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: space.lg + 16 },
  footer: { padding: space.lg, gap: space.sm },
  center: { textAlign: 'center' },
  month: { paddingHorizontal: space.lg, paddingTop: space.md, gap: space.md },
  dayTitle: { marginTop: space.sm },
  dayList: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
});
