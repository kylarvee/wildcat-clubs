import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useNavigation } from 'expo-router';
import { errorMessage } from '@/api/client';
import { Api } from '@/api/endpoints';
import type { MNotification } from '@/api/types';
import { useSession } from '@/auth/session';
import { listContent } from '@/components/Screen';
import { SignInPrompt } from '@/components/SignInPrompt';
import { EmptyView, ErrorView, InlineNotice, LoadingView } from '@/components/States';
import { Text } from '@/components/Text';
import { Icon } from '@/components/Icon';
import { timeAgo } from '@/lib/format';
import { openHref, routeForHref } from '@/lib/links';
import { useApi } from '@/lib/use-api';
import { space, useColors } from '@/theme';

export default function InboxScreen() {
  const { status, user } = useSession();
  if (status === 'loading') return <LoadingView />;
  if (!user) return <SignInPrompt icon="inbox" title="Your notifications" body="Sign in to see join approvals, new announcements, event reminders and more." />;
  return <Inbox userId={user.id} />;
}

/** Notifications, unread first. Tapping one marks it read and opens what it's about. */
function Inbox({ userId }: { userId: string }) {
  const c = useColors();
  const navigation = useNavigation();
  const { setUnread } = useSession();
  const { data, error, loading, refreshing, refresh, reload, setData } = useApi(`inbox:${userId}`, Api.notifications, { staleMs: 15_000 });
  const [actionError, setActionError] = useState<string | null>(null);

  // Keep the tab badge in step with what this screen loaded.
  useEffect(() => {
    if (data) setUnread(data.unread);
  }, [data, setUnread]);

  const markAll = useCallback(async () => {
    setActionError(null);
    const before = data;
    setData((d) => (d ? { unread: 0, items: d.items.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) } : d));
    try {
      const r = await Api.markRead({ all: true });
      setUnread(r.unread);
    } catch (e) {
      setData(() => before);
      setActionError(errorMessage(e));
    }
  }, [data, setData, setUnread]);

  const unread = data?.unread ?? 0;
  useEffect(() => {
    navigation.setOptions({
      headerRight: unread
        ? () => (
            <Pressable onPress={() => void markAll()} accessibilityRole="button" accessibilityLabel="Mark all as read" hitSlop={10} style={styles.headerButton}>
              <Text variant="label" tone="brand">
                Mark all read
              </Text>
            </Pressable>
          )
        : undefined,
    });
  }, [navigation, unread, markAll]);

  const open = async (n: MNotification) => {
    if (!n.readAt) {
      setData((d) => (d ? { unread: Math.max(0, d.unread - 1), items: d.items.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)) } : d));
      Api.markRead({ ids: [n.id] })
        .then((r) => setUnread(r.unread))
        .catch(() => {});
    }
    openHref(n.href);
  };

  if (loading && !data) return <LoadingView label="Loading notifications" />;
  if (!data) return <ErrorView error={error} onRetry={reload} />;

  return (
    <FlatList
      style={{ backgroundColor: c.background }}
      data={data.items}
      keyExtractor={(n) => n.id}
      contentContainerStyle={listContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.brandText} colors={[c.brand]} />}
      ListHeaderComponent={
        error || actionError ? (
          <View style={styles.pad}>
            {actionError ? <InlineNotice tone="danger">{actionError}</InlineNotice> : <InlineNotice error={error} />}
          </View>
        ) : undefined
      }
      ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.line }]} />}
      ListEmptyComponent={
        <View style={styles.pad}>
          <EmptyView icon="bell" title="You're all caught up" body="Join approvals, announcements and event reminders will show up here." />
        </View>
      }
      renderItem={({ item }) => <NotificationRow item={item} onPress={() => void open(item)} />}
    />
  );
}

function NotificationRow({ item, onPress }: { item: MNotification; onPress: () => void }) {
  const c = useColors();
  const unread = !item.readAt;
  const opensWeb = item.href ? !routeForHref(item.href) : false;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${unread ? 'Unread. ' : ''}${item.title}. ${item.body ?? ''} ${timeAgo(item.createdAt)}`}
      accessibilityHint={item.href ? (opensWeb ? 'Opens on the web' : 'Opens it in the app') : undefined}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.surfaceAlt : unread ? c.brandTint : 'transparent' }]}>
      <View style={[styles.dot, { backgroundColor: unread ? c.brand : 'transparent' }]} />
      <View style={styles.body}>
        <Text variant={unread ? 'label' : 'body'} numberOfLines={2}>
          {item.title}
        </Text>
        {item.body ? (
          <Text variant="small" tone="ink2" numberOfLines={3}>
            {item.body}
          </Text>
        ) : null}
        <View style={styles.meta}>
          <Text variant="caption" tone="ink3">
            {timeAgo(item.createdAt)}
          </Text>
          {opensWeb ? <Icon name="external" size={12} color={c.ink3} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pad: { padding: space.lg },
  headerButton: { paddingHorizontal: space.lg, minHeight: 44, justifyContent: 'center' },
  row: { flexDirection: 'row', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 64 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  body: { flex: 1, gap: 3 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sep: { height: StyleSheet.hairlineWidth },
});
