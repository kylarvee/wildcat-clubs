import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { ApiError } from '@/api/client';
import { Api } from '@/api/endpoints';
import { useSession } from '@/auth/session';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, SectionHeader } from '@/components/Card';
import { ClubLogo } from '@/components/ClubLogo';
import { Icon, type IconName } from '@/components/Icon';
import { LeaderCheckinCard } from '@/components/LeaderCheckinCard';
import { ScrollScreen } from '@/components/Screen';
import { SignInPrompt } from '@/components/SignInPrompt';
import { ErrorView, InlineNotice, LoadingView } from '@/components/States';
import { Text } from '@/components/Text';
import { openMaps, openWeb } from '@/lib/links';
import { useApi } from '@/lib/use-api';
import { space, useColors } from '@/theme';

/** One meeting: when, where (with a map), who's hosting, and the details. */
export default function EventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useSession();
  const c = useColors();
  const { data, error, loading, refreshing, refresh, reload } = useApi(`event:${user?.id ?? 'anon'}:${id}`, () => Api.event(String(id)));

  if (loading && !data) return <LoadingView label="Loading event" />;
  if (!data) {
    if (error instanceof ApiError && error.code === 'UNAUTHENTICATED') {
      return <SignInPrompt icon="calendar" title="Sign in to see this event" body="It's for Weber State students, faculty and staff." />;
    }
    return <ErrorView error={error} onRetry={error instanceof ApiError && error.unreachable ? reload : undefined} />;
  }

  const e = data;
  return (
    <ScrollScreen refreshing={refreshing} onRefresh={refresh}>
      <Stack.Screen options={{ title: e.kindLabel }} />
      {error ? <InlineNotice error={error} /> : null}
      {e.cancelled ? <InlineNotice tone="danger">{e.note ? `This meeting is cancelled: ${e.note}` : 'This meeting is cancelled.'}</InlineNotice> : null}

      <Text variant="display" accessibilityRole="header" style={e.cancelled ? { textDecorationLine: 'line-through', color: c.ink3 } : undefined}>
        {e.title}
      </Text>
      <View style={styles.badges}>
        {e.happeningNow && !e.cancelled ? <Badge label="Happening now" tone="live" /> : null}
        <Badge label={e.visibility === 'PUBLIC' ? 'Open to everyone' : e.visibility === 'UNIVERSITY' ? 'Weber State only' : 'Members only'} tone="neutral" />
      </View>

      {/* Leaders who can run check-in, while it's open (the server decides). */}
      {e.leaderCheckin ? <LeaderCheckinCard item={e.leaderCheckin} showTitle={false} /> : null}

      <Card style={styles.facts}>
        <Fact icon="time" title={`${e.dayLabel} · ${e.timeLabel}`} detail={e.scheduleLabel ?? undefined} />
        {e.isVirtual ? (
          <Fact icon="video" title="Online" detail={e.virtualUrl ? 'Tap to join' : 'The link comes from the club.'} onPress={e.virtualUrl ? () => void Linking.openURL(e.virtualUrl!) : undefined} />
        ) : (
          <Fact icon="place" title={e.location} detail={e.mapQuery ? 'Open in Maps' : undefined} onPress={e.mapQuery ? () => openMaps(e.mapQuery!) : undefined} />
        )}
      </Card>

      {e.club ? (
        <Card
          onPress={() => router.push({ pathname: '/club/[slug]', params: { slug: e.club!.slug } })}
          style={styles.host}
          accessibilityLabel={`Hosted by ${e.club.name}${e.cohostNames.length ? ` with ${e.cohostNames.join(', ')}` : ''}`}>
          <ClubLogo name={e.club.name} logoUrl={e.club.logoUrl} color={e.club.logoColor} size={40} />
          <View style={styles.flex}>
            <Text variant="small" tone="ink3">
              Hosted by
            </Text>
            <Text variant="label">{e.club.name}</Text>
            {e.cohostNames.length ? (
              <Text variant="small" tone="ink2">
                with {e.cohostNames.join(', ')}
              </Text>
            ) : null}
          </View>
          <Icon name="chevron" size={16} color={c.ink3} />
        </Card>
      ) : (
        <Text tone="ink2" style={styles.uni}>
          A Weber State University event.
        </Text>
      )}

      {e.description ? (
        <>
          <SectionHeader title="Details" />
          <Text tone="ink2">{e.description}</Text>
        </>
      ) : null}

      {e.links.length ? (
        <>
          <SectionHeader title="Links" />
          {e.links.map((l) => (
            <Pressable key={l.url} onPress={() => void Linking.openURL(l.url)} accessibilityRole="link" style={styles.link}>
              <Icon name="link" size={18} color={c.brandText} />
              <Text tone="brand" numberOfLines={1} style={styles.flex}>
                {l.label || l.url}
              </Text>
            </Pressable>
          ))}
        </>
      ) : null}

      <Button title="Open on the web" variant="ghost" icon="external" onPress={() => void openWeb(e.webPath)} style={styles.web} accessibilityHint="Add to your calendar, see attachments and more" />
    </ScrollScreen>
  );
}

function Fact({ icon, title, detail, onPress }: { icon: IconName; title: string; detail?: string; onPress?: () => void }) {
  const c = useColors();
  const body = (
    <>
      <Icon name={icon} size={20} color={c.brandText} />
      <View style={styles.flex}>
        <Text variant="label">{title}</Text>
        {detail ? (
          <Text variant="small" tone={onPress ? 'brand' : 'ink2'}>
            {detail}
          </Text>
        ) : null}
      </View>
    </>
  );
  if (!onPress) return <View style={styles.fact}>{body}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}. ${detail ?? ''}`} style={({ pressed }) => [styles.fact, pressed && { opacity: 0.7 }]}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  badges: { flexDirection: 'row', gap: space.xs, marginTop: space.sm, flexWrap: 'wrap' },
  facts: { gap: space.md, marginTop: space.lg },
  fact: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start', minHeight: 44 },
  host: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.md },
  uni: { marginTop: space.md },
  link: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 },
  web: { marginTop: space.xl },
});
