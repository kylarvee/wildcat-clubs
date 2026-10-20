import { Pressable, StyleSheet, View } from 'react-native';
import type { MEvent } from '@/api/types';
import { safeHex, space, useColors } from '@/theme';
import { Badge } from '@/components/Badge';
import { EventBadges, eventBadgeList } from '@/components/EventBadges';
import { EventCover } from '@/components/EventCover';
import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * One meeting in a list, with its badges ("Free food", "Service hours · 2",
 * "Hybrid"…). `showDate` adds a calendar tile (lists that aren't grouped by
 * day); `showCover` puts the event's cover image on top when it has one.
 */
export function EventRow({ event, onPress, showDate = true, showClub = true, showCover = false }: { event: MEvent; onPress?: () => void; showDate?: boolean; showClub?: boolean; showCover?: boolean }) {
  const c = useColors();
  const [, month, day] = event.dayKey.split('-');
  const label = [
    event.title,
    event.cancelled ? 'Cancelled' : null,
    event.happeningNow && !event.cancelled ? 'Happening now' : null,
    `${event.dayLabel}, ${event.timeLabel}`,
    event.location,
    showClub && event.club ? event.club.name : null,
    ...eventBadgeList(event).map((b) => b.label),
  ]
    .filter(Boolean)
    .join('. ');
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.wrap, pressed && { backgroundColor: c.surfaceAlt }]}>
      {showCover ? <EventCover url={event.coverUrl} color={event.club?.logoColor} style={styles.cover} /> : null}
      <View style={styles.row}>
        {showDate ? (
          <View style={[styles.date, { backgroundColor: c.brandTint }]}>
            <Text variant="caption" tone="brand">
              {MONTHS[Number(month) - 1] ?? ''}
            </Text>
            <Text variant="title" tone="brand" style={styles.day} maxFontSizeMultiplier={1.2}>
              {Number(day)}
            </Text>
          </View>
        ) : (
          <View style={[styles.stripe, { backgroundColor: safeHex(event.club?.logoColor) }]} />
        )}
        <View style={styles.body}>
          <Text variant="label" numberOfLines={2} style={event.cancelled ? { textDecorationLine: 'line-through', color: c.ink3 } : undefined}>
            {event.title}
          </Text>
          <View style={styles.meta}>
            <Icon name="time" size={14} color={c.ink3} />
            <Text variant="small" tone="ink2" numberOfLines={1} style={styles.flex}>
              {showDate ? `${event.dayLabel.split(', ')[0]} · ${event.timeLabel}` : event.timeLabel}
            </Text>
          </View>
          <View style={styles.meta}>
            <Icon name={event.isVirtual ? 'video' : 'place'} size={14} color={c.ink3} />
            <Text variant="small" tone="ink2" numberOfLines={1} style={styles.flex}>
              {event.hybrid ? `${event.location} · and online` : event.location}
            </Text>
          </View>
          {(showClub && event.club) || event.cancelled || event.happeningNow ? (
            <View style={styles.tags}>
              {showClub && event.club ? (
                <Text variant="caption" tone="ink3" numberOfLines={1} style={styles.flex}>
                  {event.club.name}
                  {event.cohostNames.length ? ` + ${event.cohostNames.length === 1 ? event.cohostNames[0] : `${event.cohostNames.length} clubs`}` : ''}
                </Text>
              ) : (
                <View style={styles.flex} />
              )}
              {event.cancelled ? <Badge label="Cancelled" tone="danger" /> : event.happeningNow ? <Badge label="Now" tone="live" /> : null}
            </View>
          ) : null}
          <EventBadges event={event} style={styles.badges} />
          {event.cancelled && event.note ? (
            <Text variant="small" tone="danger" numberOfLines={2}>
              {event.note}
            </Text>
          ) : null}
        </View>
        {onPress ? <Icon name="chevron" size={16} color={c.ink3} style={styles.chevron} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: space.md, paddingHorizontal: space.lg, gap: space.md },
  cover: { marginBottom: 0 },
  badges: { marginTop: 4 },
  row: { flexDirection: 'row', gap: space.md, minHeight: 40 },
  date: { width: 52, height: 56, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  day: { lineHeight: 26 },
  stripe: { width: 4, borderRadius: 2, alignSelf: 'stretch' },
  body: { flex: 1, gap: 3 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tags: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 2 },
  flex: { flex: 1 },
  chevron: { alignSelf: 'center' },
});
