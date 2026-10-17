import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { radius, space, useColors } from '@/theme';
import { Text } from '@/components/Text';
import { Icon } from '@/components/Icon';

/** A plain surface with a hairline border. Pass onPress to make the whole card a button. */
export function Card({
  children,
  style,
  onPress,
  accessibilityLabel,
  accessibilityHint,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const c = useColors();
  const base = [styles.card, { backgroundColor: c.surface, borderColor: c.line }, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [base, pressed && { backgroundColor: c.surfaceAlt }]}>
      {children}
    </Pressable>
  );
}

/** A section title with an optional action link on the right. */
export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.header}>
      <Text variant="heading" accessibilityRole="header" style={styles.headerTitle}>
        {title}
      </Text>
      {action && onAction ? (
        <Pressable onPress={onAction} accessibilityRole="link" hitSlop={12} style={styles.headerAction}>
          <Text variant="label" tone="brand">
            {action}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A tappable row with a chevron (lists of clubs, settings). */
export function Row({
  children,
  onPress,
  accessibilityLabel,
  chevron = true,
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  chevron?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const content = (
    <>
      <View style={styles.rowBody}>{children}</View>
      {onPress && chevron ? <Icon name="chevron" size={16} color={c.ink3} /> : null}
    </>
  );
  if (!onPress) return <View style={[styles.row, style]}>{content}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.surfaceAlt }, style]}>
      {content}
    </Pressable>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const c = useColors();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.line, marginLeft: inset }} />;
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space.lg },
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: space.xl, marginBottom: space.sm, gap: space.md },
  headerTitle: { flexShrink: 1 },
  headerAction: { minHeight: 32, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingVertical: space.sm, paddingHorizontal: space.lg },
  rowBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
});
