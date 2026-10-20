import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { MEvent } from '@/api/types';
import { Badge } from '@/components/Badge';
import { space } from '@/theme';

type Item = { key: string; label: string; tone: 'success' | 'brand' | 'neutral' };

/** An event's badges, in the web's words and order (lib/events/labels eventBadges): perks, service hours, online or hybrid, members only. */
export function eventBadgeList(e: Pick<MEvent, 'perks' | 'serviceHours' | 'isVirtual' | 'hybrid' | 'visibility'>): Item[] {
  const perks = e.perks ?? [];
  const out: Item[] = [];
  if (perks.includes('FREE_FOOD')) out.push({ key: 'food', label: 'Free food', tone: 'success' });
  if (perks.includes('FREE_STUFF')) out.push({ key: 'stuff', label: 'Free stuff', tone: 'success' });
  if (e.serviceHours) out.push({ key: 'service', label: `Service hours · ${e.serviceHours}`, tone: 'brand' });
  if (e.isVirtual) out.push({ key: 'online', label: 'Online', tone: 'neutral' });
  else if (e.hybrid) out.push({ key: 'hybrid', label: 'Hybrid', tone: 'neutral' });
  if (e.visibility === 'MEMBERS') out.push({ key: 'members', label: 'Members only', tone: 'neutral' });
  return out;
}

export function EventBadges({ event, style }: { event: Pick<MEvent, 'perks' | 'serviceHours' | 'isVirtual' | 'hybrid' | 'visibility'>; style?: StyleProp<ViewStyle> }) {
  const items = eventBadgeList(event);
  if (!items.length) return null;
  return (
    <View style={[styles.row, style]}>
      {items.map((b) => (
        <Badge key={b.key} label={b.label} tone={b.tone} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
});
