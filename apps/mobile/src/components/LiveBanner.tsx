import { StyleSheet, View } from 'react-native';
import type { MOccurrence } from '@/api/types';
import { radius, space, useColors } from '@/theme';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';

/** "Happening now — Check in / Not now" for an event whose check-in is open. */
export function LiveBanner({ occurrence, onCheckIn, onDismiss, busy = false }: { occurrence: MOccurrence; onCheckIn: () => void; onDismiss: () => void; busy?: boolean }) {
  const c = useColors();
  const host = occurrence.club?.name ?? 'Weber State';
  return (
    <View style={[styles.card, { backgroundColor: c.brand }]} accessibilityRole="summary">
      <View style={styles.kicker}>
        <Icon name="live" size={16} color={c.onBrand} />
        <Text variant="caption" tone="onBrand" style={styles.kickerText} numberOfLines={1}>
          HAPPENING NOW · {host.toUpperCase()}
        </Text>
      </View>
      <Text variant="title" tone="onBrand" accessibilityRole="header">
        {occurrence.title}
      </Text>
      <Text tone="onBrand" style={styles.sub}>
        {[occurrence.place, occurrence.whenLabel].filter(Boolean).join(' · ')}
      </Text>
      <Text tone="onBrand" style={styles.sub}>
        Check-in is open. Are you here?
      </Text>
      <View style={styles.actions}>
        <Button title="Check in" icon="checkCircle" variant="onBrand" onPress={onCheckIn} loading={busy} style={styles.primary} accessibilityHint={`Checks you in to ${occurrence.title}`} />
        <Button title="Not now" variant="primary" onPress={onDismiss} style={[styles.secondary, { borderColor: 'rgba(255,255,255,0.5)' }]} accessibilityHint="Hides this until you reopen the app" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: space.lg, gap: 4, marginBottom: space.md },
  kicker: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  kickerText: { letterSpacing: 1 },
  sub: { opacity: 0.9 },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.md, flexWrap: 'wrap' },
  primary: { flexGrow: 1, flexBasis: 140 },
  secondary: { flexGrow: 1, flexBasis: 110 },
});
