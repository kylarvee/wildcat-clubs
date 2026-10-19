import { Pressable, StyleSheet } from 'react-native';
import { useColors } from '@/theme';
import { Icon } from '@/components/Icon';

/** A checkbox with a thumb-sized target, announced as a checkbox. */
export function Checkbox({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  const c = useColors();
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      disabled={disabled}
      hitSlop={10}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.box, { opacity: disabled ? 0.5 : pressed ? 0.6 : 1 }]}>
      <Icon name={checked ? 'boxChecked' : 'box'} size={26} color={checked ? c.brandText : c.ink3} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
});
