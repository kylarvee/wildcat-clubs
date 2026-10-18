import { useCallback, useRef, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { router, useFocusEffect, useIsFocused } from 'expo-router';
import { useSession } from '@/auth/session';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { LoadingView } from '@/components/States';
import { Text } from '@/components/Text';
import { parseCheckinInput, tidyCode } from '@/lib/checkin-link';
import { MAX_WIDTH, radius, space, TAP, useColors } from '@/theme';

/**
 * Scan to check in. Works before signing in: the check-in screen keeps the
 * scan, asks you to sign in (or create your account), then finishes.
 */
export default function ScanScreen() {
  const c = useColors();
  const focused = useIsFocused();
  const { status } = useSession();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [manual, setManual] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const locked = useRef(false);
  // The same QR right after coming back (still in view) shouldn't reopen the screen you just left.
  const last = useRef<{ data: string; at: number } | null>(null);

  // Coming back to this tab: ready for the next scan.
  useFocusEffect(
    useCallback(() => {
      locked.current = false;
      setNotice(null);
      if (last.current) last.current = { ...last.current, at: Date.now() };
      return () => setTorch(false);
    }, []),
  );

  const go = useCallback((code: string, token: string | null) => {
    locked.current = true;
    setManual(false);
    router.push({ pathname: '/c/[code]', params: { code, ...(token ? { t: token } : {}), auto: '1' } });
  }, []);

  const onScanned = useCallback(
    ({ data }: BarcodeScanningResult) => {
      if (locked.current) return;
      if (last.current?.data === data && Date.now() - last.current.at < 8000) return;
      last.current = { data, at: Date.now() };
      const parsed = parseCheckinInput({ url: data });
      if (!parsed) {
        locked.current = true;
        setNotice("That QR code isn't a Wildcat Clubs check-in code. Look for the code on the club's check-in screen.");
        setTimeout(() => {
          locked.current = false;
        }, 2500);
        return;
      }
      go(parsed.code, parsed.token);
    },
    [go],
  );

  const showManual = manual || Boolean(cameraError) || (permission != null && !permission.granted);

  if (!permission) return <LoadingView label="Checking camera access" />;

  return (
    <KeyboardAvoidingView style={[styles.flex, { backgroundColor: permission.granted && !cameraError ? '#000' : c.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      {permission.granted && !cameraError ? (
        <View style={styles.flex}>
          {focused ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              enableTorch={torch}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={onScanned}
              onMountError={(e) => setCameraError(e.message || "The camera didn't start.")}
              accessibilityLabel="Camera viewfinder for scanning a check-in QR code"
            />
          ) : null}
          <View style={styles.overlay} pointerEvents="box-none">
            <Text variant="heading" tone="onBrand" style={styles.hint}>
              Point at the QR code on the club&apos;s check-in screen
            </Text>
            <View style={styles.frame} pointerEvents="none" accessible={false}>
              <View style={[styles.corner, styles.tl]} />
              <View style={[styles.corner, styles.tr]} />
              <View style={[styles.corner, styles.bl]} />
              <View style={[styles.corner, styles.br]} />
            </View>
            {notice ? (
              <View style={[styles.toast, { backgroundColor: c.surface }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
                <Text variant="small">{notice}</Text>
              </View>
            ) : status === 'signedOut' ? (
              <Text variant="small" tone="onBrand" style={styles.hint}>
                Not signed in? Scan anyway — you can sign in right after.
              </Text>
            ) : null}
            <View style={styles.controls}>
              <Pressable
                onPress={() => setTorch((t) => !t)}
                accessibilityRole="switch"
                accessibilityLabel="Flashlight"
                accessibilityState={{ checked: torch }}
                style={({ pressed }) => [styles.round, { opacity: pressed ? 0.7 : 1 }]}>
                <Icon name={torch ? 'torchOn' : 'torchOff'} color="#fff" size={24} />
              </Pressable>
              <Pressable onPress={() => setManual(true)} accessibilityRole="button" accessibilityLabel="Enter a code instead" style={({ pressed }) => [styles.pill, { opacity: pressed ? 0.7 : 1 }]}>
                <Icon name="keyboard" color="#fff" size={20} />
                <Text variant="label" tone="onBrand">
                  Enter code
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : (
        <CameraBlocked
          canAsk={permission.canAskAgain && !cameraError}
          cameraError={cameraError}
          onAllow={() => void requestPermission()}
        />
      )}
      {showManual ? <ManualEntry onSubmit={(code) => go(code, null)} onCancel={permission.granted && !cameraError ? () => setManual(false) : undefined} /> : null}
    </KeyboardAvoidingView>
  );
}

function CameraBlocked({ canAsk, cameraError, onAllow }: { canAsk: boolean; cameraError: string | null; onAllow: () => void }) {
  const c = useColors();
  return (
    <View style={styles.blocked}>
      <View style={[styles.blockedIcon, { backgroundColor: c.brandTint }]}>
        <Icon name="scan" size={36} color={c.brandText} />
      </View>
      <Text variant="title" style={styles.center} accessibilityRole="header">
        {cameraError ? "The camera isn't available" : 'Scan with your camera'}
      </Text>
      <Text tone="ink2" style={styles.center}>
        {cameraError
          ? `${cameraError} Members of the club hosting the event can type the check-in code instead — it's on the check-in screen.`
          : 'Wildcat Clubs uses the camera only to read the check-in QR code at club events.'}
      </Text>
      {cameraError ? null : canAsk ? (
        <Button title="Allow camera" icon="scan" onPress={onAllow} style={styles.blockedButton} />
      ) : (
        <Button title="Open Settings" icon="external" variant="secondary" onPress={() => void Linking.openSettings()} style={styles.blockedButton} />
      )}
    </View>
  );
}

function ManualEntry({ onSubmit, onCancel }: { onSubmit: (code: string) => void; onCancel?: () => void }) {
  const c = useColors();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    const code = tidyCode(value);
    if (code.length < 4) {
      setError('Check-in codes are 6 letters and numbers, like HERE26.');
      return;
    }
    setError(null);
    onSubmit(code);
  };
  return (
    <View style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.line }]}>
      <View style={styles.sheetInner}>
        <Text variant="heading" nativeID="code-label">
          Enter the check-in code
        </Text>
        <Text variant="small" tone="ink2">
          It&apos;s the 6-character code on the event&apos;s check-in screen. Typed codes work for members of the clubs hosting the event.
        </Text>
        <TextInput
          value={value}
          onChangeText={(t) => {
            setValue(t.toUpperCase());
            if (error) setError(null);
          }}
          placeholder="ABC234"
          placeholderTextColor={c.ink3}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          maxLength={14}
          returnKeyType="go"
          onSubmitEditing={submit}
          accessibilityLabel="Check-in code"
          accessibilityLabelledBy="code-label"
          style={[styles.input, { color: c.ink, borderColor: error ? c.danger : c.line, backgroundColor: c.surfaceAlt }]}
        />
        {error ? (
          <Text variant="small" tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <View style={styles.sheetActions}>
          <Button title="Check in" icon="checkCircle" onPress={submit} style={styles.flex} />
          {onCancel ? <Button title="Cancel" variant="ghost" onPress={onCancel} /> : null}
        </View>
      </View>
    </View>
  );
}

const CORNER = 28;
const styles = StyleSheet.create({
  flex: { flex: 1 },
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'space-between', padding: space.xl },
  hint: { textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6, maxWidth: 360, marginTop: space.md },
  frame: { width: 250, height: 250 },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: '#fff' },
  tl: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 12 },
  tr: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 12 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 12 },
  br: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 12 },
  toast: { borderRadius: radius.md, padding: space.md, maxWidth: 360 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.md },
  round: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 56, paddingHorizontal: 22, borderRadius: 28, backgroundColor: 'rgba(0,0,0,0.55)' },
  blocked: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xxl },
  blockedIcon: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  blockedButton: { alignSelf: 'stretch', maxWidth: 420, width: '100%' },
  center: { textAlign: 'center', maxWidth: 420 },
  sheet: { borderTopWidth: StyleSheet.hairlineWidth, paddingBottom: space.lg },
  sheetInner: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', padding: space.lg, gap: space.sm },
  input: { minHeight: TAP + 8, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.lg, fontSize: 24, fontWeight: '700', letterSpacing: 4 },
  sheetActions: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
});
