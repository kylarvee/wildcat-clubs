import { StyleSheet, View } from 'react-native';
import { radius, useColors } from '@/theme';
import { Text } from '@/components/Text';

type Tone = 'brand' | 'success' | 'warning' | 'danger' | 'neutral' | 'live';

/** A small status pill ("Member", "Requested", "Happening now"). */
export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const c = useColors();
  const map: Record<Tone, { bg: string; fg: string }> = {
    brand: { bg: c.brandTint, fg: c.brandText },
    success: { bg: c.successTint, fg: c.success },
    warning: { bg: c.warningTint, fg: c.warning },
    danger: { bg: c.dangerTint, fg: c.danger },
    neutral: { bg: c.surfaceAlt, fg: c.ink2 },
    live: { bg: c.dangerTint, fg: c.live },
  };
  const t = map[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg }]}>
      <Text variant="caption" style={{ color: t.fg }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
});
