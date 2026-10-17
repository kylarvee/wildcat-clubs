import { Platform, Switch } from 'react-native';
import { useColors } from '@/theme';

/** An on/off switch in Wildcat purple on every platform (the web preview has its own default colors). */
export function Toggle({ value, onValueChange, disabled, accessibilityLabel }: { value: boolean; onValueChange: (v: boolean) => void; disabled?: boolean; accessibilityLabel: string }) {
  const c = useColors();
  const web = Platform.OS === 'web' ? ({ activeThumbColor: '#ffffff', activeTrackColor: c.brand } as object) : {};
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ true: c.brand, false: c.line }}
      thumbColor="#ffffff"
      ios_backgroundColor={c.line}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      {...web}
    />
  );
}
