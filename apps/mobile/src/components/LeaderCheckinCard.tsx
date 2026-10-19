import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import type { MLeaderCheckin } from '@/api/types';
import { space, useColors } from '@/theme';
import { campusTime } from '@/lib/format';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';

/**
 * Running check-in from the phone: the rotating QR to hold up at the door,
 * and adding someone who can't scan. The server only sends these while
 * check-in is open, to people with the Attendance permission in the host club.
 */
export function LeaderCheckinCard({ item, showTitle = true }: { item: MLeaderCheckin; showTitle?: boolean }) {
  const c = useColors();
  const o = item.occurrence;
  const params = { id: o.id, title: o.title };
  return (
    <Card style={[styles.card, { borderColor: c.brand }]}>
      <View style={styles.head}>
        <Icon name="live" size={18} color={c.brandText} />
        <Text variant="label" tone="brand" style={styles.flex}>
          Check-in is open · {item.checkedIn} checked in
        </Text>
      </View>
      {showTitle ? <Text variant="label">{o.title}</Text> : null}
      <Text variant="small" tone="ink2">
        Open until {campusTime(o.closesAt)}. You can run it from this phone.
      </Text>
      <View style={styles.actions}>
        <Button title="Show check-in QR" icon="qr" onPress={() => router.push({ pathname: '/live/[id]', params })} style={styles.grow} accessibilityHint="Shows the rotating QR code full screen" />
        <Button title="Add someone" icon="join" variant="secondary" onPress={() => router.push({ pathname: '/live/add/[id]', params })} style={styles.grow} accessibilityHint="Checks in someone who can't scan" />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.xs, marginTop: space.md, borderWidth: 1.5 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  flex: { flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  grow: { flexGrow: 1, flexBasis: 150 },
});
