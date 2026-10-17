import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { MAX_WIDTH, space, useColors } from '@/theme';

/** A scrolling screen body: theme background, readable max width, pull to refresh. */
export function ScrollScreen({
  children,
  refreshing = false,
  onRefresh,
  contentStyle,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.brandText} colors={[c.brand]} /> : undefined}>
      <View style={[styles.inner, contentStyle]}>{children}</View>
    </ScrollView>
  );
}

/** The same width rules for FlatList / SectionList content. */
export const listContent = { paddingBottom: space.xxl, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' } as const;

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingBottom: space.xxl },
  inner: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', paddingHorizontal: space.lg, paddingTop: space.lg },
});
