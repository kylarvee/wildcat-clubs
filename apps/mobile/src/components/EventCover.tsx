import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { absoluteUrl } from '@/components/ClubLogo';
import { safeHex } from '@/theme';

/**
 * An event's cover image over a blurred copy of itself, so a tall flyer shows
 * whole and a wide photo fills the frame (like the web). Renders nothing when
 * the event has no cover or it can't load. Decorative: the text says what it shows.
 */
export function EventCover({ url, color, style }: { url: string | null; color?: string | null; style?: StyleProp<ViewStyle> }) {
  const [failed, setFailed] = useState(false);
  const uri = absoluteUrl(url);
  if (!uri || failed) return null;
  return (
    <View style={[styles.box, { backgroundColor: safeHex(color) }, style]} accessible={false} importantForAccessibility="no-hide-descendants">
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={30} accessible={false} />
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" onError={() => setFailed(true)} accessible={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: '100%', aspectRatio: 2, overflow: 'hidden', borderRadius: 12 },
});
