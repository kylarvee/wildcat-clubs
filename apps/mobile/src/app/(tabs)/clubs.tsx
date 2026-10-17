import { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Api } from '@/api/endpoints';
import type { MClubListItem } from '@/api/types';
import { useSession } from '@/auth/session';
import { Badge } from '@/components/Badge';
import { ClubLogo } from '@/components/ClubLogo';
import { Icon } from '@/components/Icon';
import { listContent } from '@/components/Screen';
import { EmptyView, ErrorView, InlineNotice, LoadingView } from '@/components/States';
import { Text } from '@/components/Text';
import { plural } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { radius, space, TAP, useColors } from '@/theme';

/** Browse and search every approved club (works signed out). */
export default function ClubsScreen() {
  const c = useColors();
  const { user } = useSession();
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');

  // Search as you type, without a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data, error, loading, refreshing, refresh, reload } = useApi(`clubs:${user?.id ?? 'anon'}:${q}`, () => Api.clubs(q), { staleMs: 60_000, keepPrevious: true });

  return (
    <View style={[styles.flex, { backgroundColor: c.background }]}>
      <View style={[styles.searchWrap, { borderBottomColor: c.line }]}>
        <View style={[styles.search, { backgroundColor: c.surfaceAlt }]}>
          <Icon name="search" size={18} color={c.ink3} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search clubs, majors, colleges"
            placeholderTextColor={c.ink3}
            returnKeyType="search"
            autoCorrect={false}
            clearButtonMode="while-editing"
            accessibilityLabel="Search clubs"
            style={[styles.input, { color: c.ink }]}
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={10}>
              <Icon name="close" size={18} color={c.ink3} />
            </Pressable>
          ) : null}
        </View>
      </View>
      {loading && !data ? (
        <LoadingView label="Loading clubs" />
      ) : !data ? (
        <ErrorView error={error} onRetry={reload} />
      ) : (
        <FlatList
          data={data.items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={listContent}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.brandText} colors={[c.brand]} />}
          ListHeaderComponent={
            <View style={styles.listHead}>
              {error ? <InlineNotice error={error} /> : null}
              <Text variant="small" tone="ink3" accessibilityLiveRegion="polite">
                {loading ? 'Searching…' : q ? `${plural(data.items.length, 'club')} ${data.items.length === 1 ? 'matches' : 'match'} “${q}”` : `${plural(data.total, 'club')} at Weber State`}
              </Text>
            </View>
          }
          ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.line }]} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <EmptyView icon="search" title="No clubs match" body="Try a shorter word, a major, or a college name." action="Clear search" onAction={() => setQuery('')} />
            </View>
          }
          renderItem={({ item }) => <ClubRow club={item} />}
        />
      )}
    </View>
  );
}

function ClubRow({ club }: { club: MClubListItem }) {
  const c = useColors();
  const v = club.viewer;
  const status = v?.leader ? 'Leader' : v?.member ? 'Member' : v?.pending ? 'Requested' : v?.subscribed ? 'Following' : null;
  const m = club.metrics;
  const facts = [
    m.hasMetrics ? `${m.activeMembers} active` : null,
    m.avgRating != null && m.reviewCount > 0 ? `★ ${m.avgRating.toFixed(1)}` : null,
    club.placement,
  ].filter(Boolean);
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/club/[slug]', params: { slug: club.slug } })}
      accessibilityRole="button"
      accessibilityLabel={[club.name, status, club.shortDescription, facts.join(', ')].filter(Boolean).join('. ')}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.surfaceAlt }]}>
      <ClubLogo name={club.name} logoUrl={club.logoUrl} color={club.logoColor} size={48} />
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text variant="label" numberOfLines={1} style={styles.flex}>
            {club.name}
          </Text>
          {status ? <Badge label={status} tone={status === 'Requested' ? 'warning' : status === 'Following' ? 'neutral' : 'brand'} /> : null}
        </View>
        {club.shortDescription ? (
          <Text variant="small" tone="ink2" numberOfLines={2}>
            {club.shortDescription}
          </Text>
        ) : null}
        <Text variant="caption" tone="ink3" numberOfLines={1}>
          {facts.join(' · ')}
        </Text>
        {m.hasMetrics && (m.inPilot || !m.isActive) ? <Badge label={m.inPilot ? 'New club' : 'Not active right now'} tone="neutral" /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  searchWrap: { paddingHorizontal: space.lg, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.md, paddingHorizontal: space.md, minHeight: TAP - 4 },
  input: { flex: 1, fontSize: 16, paddingVertical: 10 },
  listHead: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xs },
  row: { flexDirection: 'row', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  body: { flex: 1, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 80 },
  empty: { padding: space.lg },
});
