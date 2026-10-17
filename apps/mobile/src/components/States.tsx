import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { ApiError, errorMessage } from '@/api/client';
import { API_URL } from '@/config';
import { radius, space, useColors } from '@/theme';
import { Button } from '@/components/Button';
import { Icon, type IconName } from '@/components/Icon';
import { Text } from '@/components/Text';

export function LoadingView({ label = 'Loading…' }: { label?: string }) {
  const c = useColors();
  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator size="large" color={c.brandText} />
    </View>
  );
}

function describe(error: unknown) {
  if (error instanceof ApiError && error.unreachable) {
    return {
      icon: 'offline' as IconName,
      title: "You're offline (or the server is)",
      body: __DEV__ ? `${error.message}\n\nThe app is looking for Wildcat Clubs at ${API_URL}.` : error.message,
    };
  }
  return { icon: 'warning' as IconName, title: "That didn't load", body: errorMessage(error) };
}

/** Full-screen error with a retry, for when there's nothing to show yet. */
export function ErrorView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const c = useColors();
  const d = describe(error);
  return (
    <View style={styles.center}>
      <Icon name={d.icon} size={40} color={c.ink3} />
      <Text variant="heading" style={styles.centerText} accessibilityRole="header">
        {d.title}
      </Text>
      <Text tone="ink2" style={styles.centerText}>
        {d.body}
      </Text>
      {onRetry ? <Button title="Try again" icon="history" variant="secondary" onPress={onRetry} style={styles.retry} /> : null}
    </View>
  );
}

/** A slim notice above content that's still showing (e.g. a refresh failed while offline). */
export function InlineNotice({ error, children, tone = 'warning' }: { error?: unknown; children?: ReactNode; tone?: 'warning' | 'info' | 'danger' | 'success' }) {
  const c = useColors();
  const colors = {
    warning: { bg: c.warningTint, fg: c.warning, icon: 'offline' as IconName },
    info: { bg: c.brandTint, fg: c.brandText, icon: 'info' as IconName },
    danger: { bg: c.dangerTint, fg: c.danger, icon: 'warning' as IconName },
    success: { bg: c.successTint, fg: c.success, icon: 'checkCircle' as IconName },
  }[tone];
  const message = children ?? (error instanceof ApiError && error.unreachable ? "Can't reach Wildcat Clubs — showing what you saw last." : errorMessage(error));
  return (
    <View style={[styles.notice, { backgroundColor: colors.bg }]} accessibilityRole="alert">
      <Icon name={colors.icon} size={18} color={colors.fg} />
      <Text variant="small" style={[styles.noticeText, { color: colors.fg }]}>
        {message}
      </Text>
    </View>
  );
}

/** A friendly empty state: what's missing and what to do about it. */
export function EmptyView({ icon, title, body, action, onAction }: { icon: IconName; title: string; body?: string; action?: string; onAction?: () => void }) {
  const c = useColors();
  return (
    <View style={[styles.empty, { borderColor: c.line }]}>
      <Icon name={icon} size={32} color={c.ink3} />
      <Text variant="heading" style={styles.centerText}>
        {title}
      </Text>
      {body ? (
        <Text tone="ink2" style={styles.centerText}>
          {body}
        </Text>
      ) : null}
      {action && onAction ? <Button title={action} variant="secondary" onPress={onAction} style={styles.retry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.md, minHeight: 280 },
  centerText: { textAlign: 'center', maxWidth: 420 },
  retry: { marginTop: space.sm, alignSelf: 'center' },
  notice: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', padding: space.md, borderRadius: radius.md, marginBottom: space.md },
  noticeText: { flex: 1 },
  empty: { alignItems: 'center', gap: space.sm, padding: space.xl, borderRadius: radius.lg, borderWidth: 1, borderStyle: 'dashed' },
});
