import { StyleSheet, View } from 'react-native';
import type { MAnnouncement } from '@/api/types';
import { space, useColors, BRAND } from '@/theme';
import { timeAgo } from '@/lib/format';
import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { ClubLogo } from '@/components/ClubLogo';
import { Text } from '@/components/Text';

/** A club or WSUSA announcement as plain text. Tapping a club's opens the club. */
export function AnnouncementCard({ item, onPress }: { item: MAnnouncement; onPress?: () => void }) {
  const c = useColors();
  const from = item.club?.name ?? 'WSUSA';
  return (
    <Card
      onPress={onPress}
      style={styles.card}
      accessibilityLabel={`${from} announcement: ${item.title}. ${timeAgo(item.createdAt)}.`}
      accessibilityHint={onPress ? `Opens ${from}` : undefined}>
      <View style={styles.head}>
        <ClubLogo name={from} logoUrl={item.club?.logoUrl ?? null} color={item.club?.logoColor ?? BRAND} size={28} />
        <Text variant="small" tone="ink2" numberOfLines={1} style={styles.from}>
          {from} · {timeAgo(item.createdAt)}
        </Text>
        {item.pinned ? <Badge label="Pinned" tone="brand" /> : null}
      </View>
      <Text variant="label">{item.title}</Text>
      {item.bodyText ? (
        <Text variant="small" tone="ink2" numberOfLines={4} style={{ color: c.ink2 }}>
          {item.bodyText}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 6, marginBottom: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: 2 },
  from: { flex: 1 },
});
