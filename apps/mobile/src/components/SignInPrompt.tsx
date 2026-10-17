import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { space, useColors } from '@/theme';
import { Button } from '@/components/Button';
import { Icon, type IconName } from '@/components/Icon';
import { Text } from '@/components/Text';

/** For tabs that need an account: what you'd see here, and a way in. */
export function SignInPrompt({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  const c = useColors();
  return (
    <View style={styles.wrap}>
      <View style={[styles.icon, { backgroundColor: c.brandTint }]}>
        <Icon name={icon} size={34} color={c.brandText} />
      </View>
      <Text variant="title" style={styles.center} accessibilityRole="header">
        {title}
      </Text>
      <Text tone="ink2" style={styles.center}>
        {body}
      </Text>
      <Button title="Sign in" icon="person" onPress={() => router.push('/welcome')} style={styles.button} />
      <Text variant="small" tone="ink3" style={styles.center}>
        Use your @mail.weber.edu or @weber.edu account.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xxl, minHeight: 360 },
  icon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  center: { textAlign: 'center', maxWidth: 420 },
  button: { alignSelf: 'stretch', maxWidth: 420, width: '100%' },
});
