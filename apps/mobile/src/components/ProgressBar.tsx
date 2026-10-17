import { StyleSheet, View } from 'react-native';
import { radius, useColors } from '@/theme';

/** A thin progress bar (value 0–1), announced as a percentage. */
export function ProgressBar({ value, label }: { value: number; label: string }) {
  const c = useColors();
  const v = Math.max(0, Math.min(1, value));
  return (
    <View
      style={[styles.track, { backgroundColor: c.surfaceAlt }]}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }}>
      <View style={[styles.fill, { width: `${v * 100}%`, backgroundColor: c.brand }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
});
