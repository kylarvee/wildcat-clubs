import { Pressable, StyleSheet, View } from 'react-native';
import type { MEvent } from '@/api/types';
import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { radius, safeHex, space, useColors } from '@/theme';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n: number) => String(n).padStart(2, '0');

/** Campus dates ("2026-10-20") are plain calendar dates; this math never touches the phone's time zone. */
export function dateKey(y: number, m: number, d: number) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function addMonths(y: number, m: number, delta: number) {
  const i = y * 12 + (m - 1) + delta;
  return { y: Math.floor(i / 12), m: (i % 12) + 1 };
}

export function monthTitle(y: number, m: number) {
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/**
 * A month grid for the Events tab's Calendar view: a dot per event (in its
 * club's color, up to three) on each day, today ringed, the chosen day
 * filled. Tapping a day shows its events below the grid.
 */
export function MonthCalendar({
  year,
  month,
  eventsByDay,
  selected,
  today,
  onSelect,
  onChangeMonth,
}: {
  year: number;
  month: number;
  eventsByDay: Map<string, MEvent[]>;
  selected: string;
  today: string;
  onSelect: (day: string) => void;
  onChangeMonth: (delta: number) => void;
}) {
  const c = useColors();
  const startDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array<null>(startDow).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));

  return (
    <View style={[styles.wrap, { backgroundColor: c.surface, borderColor: c.line }]}>
      <View style={styles.head}>
        <Pressable onPress={() => onChangeMonth(-1)} accessibilityRole="button" accessibilityLabel="Previous month" hitSlop={8} style={styles.nav}>
          <Icon name="chevron" size={18} color={c.brandText} style={styles.flip} />
        </Pressable>
        <Text variant="heading" accessibilityRole="header" accessibilityLiveRegion="polite">
          {monthTitle(year, month)}
        </Text>
        <Pressable onPress={() => onChangeMonth(1)} accessibilityRole="button" accessibilityLabel="Next month" hitSlop={8} style={styles.nav}>
          <Icon name="chevron" size={18} color={c.brandText} />
        </Pressable>
      </View>
      <View style={styles.week} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {DAY_NAMES.map((d) => (
          <Text key={d} variant="caption" tone="ink3" style={styles.dow}>
            {d[0]}
          </Text>
        ))}
      </View>
      {weeks.map((w, wi) => (
        <View key={wi} style={styles.week}>
          {w.map((d, di) => {
            if (d === null) return <View key={di} style={styles.cell} />;
            const key = dateKey(year, month, d);
            const list = eventsByDay.get(key) ?? [];
            const live = list.filter((e) => !e.cancelled);
            const isSelected = key === selected;
            const isToday = key === today;
            return (
              <Pressable
                key={di}
                onPress={() => onSelect(key)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${isToday ? 'Today, ' : ''}${DAY_NAMES[(startDow + d - 1) % 7]}, ${MONTH_NAMES[month - 1]} ${d}: ${live.length ? `${live.length} ${live.length === 1 ? 'event' : 'events'}` : 'no events'}`}
                style={styles.cell}>
                <View
                  style={[
                    styles.dayNum,
                    isSelected ? { backgroundColor: c.brand } : null,
                    isToday && !isSelected ? { borderWidth: 1.5, borderColor: c.brandText } : null,
                  ]}>
                  <Text variant="small" style={{ color: isSelected ? c.onBrand : isToday ? c.brandText : c.ink, fontWeight: isToday || isSelected ? '700' : '400' }} maxFontSizeMultiplier={1.2}>
                    {d}
                  </Text>
                </View>
                <View style={styles.dots}>
                  {live.slice(0, 3).map((e) => (
                    <View key={e.occurrenceId} style={[styles.dot, { backgroundColor: safeHex(e.club?.logoColor) }]} />
                  ))}
                  {live.length > 3 ? <Text variant="caption" tone="ink3" style={styles.more} maxFontSizeMultiplier={1}>+</Text> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: space.sm, gap: 2 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xs, paddingBottom: space.sm },
  nav: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  flip: { transform: [{ scaleX: -1 }] },
  week: { flexDirection: 'row' },
  dow: { flex: 1, textAlign: 'center', paddingBottom: space.xs },
  cell: { flex: 1, alignItems: 'center', minHeight: 48, paddingVertical: 2 },
  dayNum: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', gap: 3, height: 8, alignItems: 'center', marginTop: 2 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  more: { fontSize: 10, lineHeight: 10 },
});
