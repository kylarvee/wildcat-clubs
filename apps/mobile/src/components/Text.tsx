import { Text as RNText, type TextProps } from 'react-native';
import { font, useColors, type Colors } from '@/theme';

type Variant = keyof typeof font;
type Tone = 'ink' | 'ink2' | 'ink3' | 'brand' | 'onBrand' | 'danger' | 'success' | 'warning' | 'live';

const TONE: Record<Tone, keyof Colors> = {
  ink: 'ink',
  ink2: 'ink2',
  ink3: 'ink3',
  brand: 'brandText',
  onBrand: 'onBrand',
  danger: 'danger',
  success: 'success',
  warning: 'warning',
  live: 'live',
};

/** App text: a size from the type scale and a color from the theme. Scales with the system text size (capped so layouts hold). */
export function Text({ variant = 'body', tone = 'ink', style, ...rest }: TextProps & { variant?: Variant; tone?: Tone }) {
  const c = useColors();
  return <RNText maxFontSizeMultiplier={1.6} {...rest} style={[font[variant], { color: c[TONE[tone]] }, style]} />;
}
