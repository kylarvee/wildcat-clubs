import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { API_URL } from '@/config';
import { safeHex } from '@/theme';
import { Text } from '@/components/Text';

/** "/api/files/…" from the server → a full URL on this API host. */
export function absoluteUrl(path: string | null | undefined) {
  if (!path) return null;
  return /^https?:\/\//i.test(path) ? path : `${API_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}

function initials(name: string) {
  const words = name.replace(/[^A-Za-z0-9 &]/g, ' ').split(/\s+/).filter((w) => w && w !== '&' && !/^(of|the|and|for)$/i.test(w));
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase();
}

/** A club's logo, or its initials on its color when there's no logo (or it can't load). */
export function ClubLogo({ name, logoUrl, color, size = 44 }: { name: string; logoUrl: string | null; color: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const uri = absoluteUrl(logoUrl);
  const box = { width: size, height: size, borderRadius: size * 0.24 };
  if (uri && !failed) {
    return <Image source={{ uri }} style={[box, styles.image]} contentFit="cover" onError={() => setFailed(true)} accessibilityIgnoresInvertColors accessible={false} />;
  }
  return (
    <View style={[box, styles.fallback, { backgroundColor: safeHex(color) }]} accessible={false} importantForAccessibility="no-hide-descendants">
      <Text variant="label" tone="onBrand" style={{ fontSize: size * 0.36, lineHeight: size * 0.44 }} maxFontSizeMultiplier={1}>
        {initials(name)}
      </Text>
    </View>
  );
}

/** A person's photo or initials. */
export function Avatar({ name, url, color, size = 56 }: { name: string; url: string | null; color: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const uri = absoluteUrl(url);
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (uri && !failed) return <Image source={{ uri }} style={[box, styles.image]} contentFit="cover" onError={() => setFailed(true)} accessible={false} />;
  const parts = name.split(/\s+/).filter((p) => p && !/^(dr|prof)\.?$/i.test(p));
  const text = ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
  return (
    <View style={[box, styles.fallback, { backgroundColor: safeHex(color) }]} accessible={false} importantForAccessibility="no-hide-descendants">
      <Text variant="title" tone="onBrand" style={{ fontSize: size * 0.38, lineHeight: size * 0.46 }} maxFontSizeMultiplier={1}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: '#eee' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
});
