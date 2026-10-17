import { useColorScheme } from 'react-native';

/**
 * Wildcat Clubs on a phone: Weber purple on white, with a dark mode that
 * keeps the purple as the accent. Every screen reads colors from useColors()
 * so both modes stay in step.
 */

export const BRAND = '#492365';

const light = {
  brand: BRAND,
  brandStrong: '#341849',
  /** Purple used for text and icons on the background (links, active tab). */
  brandText: BRAND,
  brandTint: '#F3EEF8',
  onBrand: '#FFFFFF',
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceAlt: '#F6F4F9',
  ink: '#1C1724',
  ink2: '#4A4453',
  ink3: '#6E6878',
  line: '#E5E1EA',
  success: '#157F3B',
  successTint: '#E7F6EC',
  warning: '#8A5300',
  warningTint: '#FFF4DE',
  danger: '#B42318',
  dangerTint: '#FDECEA',
  live: '#C2410C',
  overlay: 'rgba(16, 10, 22, 0.55)',
};

export type Colors = typeof light;

const dark: Colors = {
  brand: '#6B3A93',
  brandStrong: '#5A2F7D',
  brandText: '#C9AEE6',
  brandTint: '#2A1D36',
  onBrand: '#FFFFFF',
  background: '#121015',
  surface: '#1C1921',
  surfaceAlt: '#24202A',
  ink: '#F4F1F7',
  ink2: '#CFC8D8',
  ink3: '#A39BAE',
  line: '#34303B',
  success: '#5BD18A',
  successTint: '#163322',
  warning: '#F2B65A',
  warningTint: '#3A2A10',
  danger: '#FF8A80',
  dangerTint: '#3D1C19',
  live: '#FB923C',
  overlay: 'rgba(0, 0, 0, 0.6)',
};

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

export function useIsDark() {
  return useColorScheme() === 'dark';
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
/** Comfortable thumb targets (Apple asks for 44pt, Material for 48dp). */
export const TAP = 48;
/** Keeps lines readable on tablets and the web preview. */
export const MAX_WIDTH = 640;

export const font = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  small: { fontSize: 14, lineHeight: 19, fontWeight: '400' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
} as const;

/** Only trust a plain 6-digit hex from the server in styles. */
export function safeHex(color: string | null | undefined, fallback = BRAND) {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}
