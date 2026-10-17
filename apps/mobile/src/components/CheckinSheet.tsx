import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { errorMessage } from '@/api/client';
import { Api } from '@/api/endpoints';
import type { MCheckinResult, MOccurrence } from '@/api/types';
import { Button } from '@/components/Button';
import { CheckinResultView } from '@/components/CheckinResultView';
import { Icon } from '@/components/Icon';
import { InlineNotice } from '@/components/States';
import { Text } from '@/components/Text';
import { MAX_WIDTH, radius, space, useColors } from '@/theme';

/**
 * The "check in?" pop-up on a club page while one of its events is on. Check
 * in happens right here; "Not now" just closes it so the page stays usable.
 */
export function CheckinSheet({ occurrence, onClose, onCheckedIn }: { occurrence: MOccurrence; onClose: (checkedIn: boolean) => void; onCheckedIn: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MCheckinResult | null>(null);

  const checkIn = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await Api.checkIn({ code: occurrence.code, via: 'mobile-popup' }));
      onCheckedIn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal transparent animationType="slide" visible onRequestClose={() => onClose(Boolean(result))} statusBarTranslucent>
      <View style={[styles.backdrop, { backgroundColor: c.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => onClose(Boolean(result))} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={[styles.sheet, { backgroundColor: c.surface, paddingBottom: insets.bottom + space.lg }]} accessibilityViewIsModal>
          <View style={[styles.grabber, { backgroundColor: c.line }]} />
          <ScrollView contentContainerStyle={styles.content} bounces={false}>
            {result ? (
              <CheckinResultView result={result} onDone={() => onClose(true)} />
            ) : (
              <>
                <View style={styles.kicker}>
                  <Icon name="live" size={18} color={c.live} />
                  <Text variant="label" tone="live">
                    Check-in is open
                  </Text>
                </View>
                <Text variant="title" accessibilityRole="header">
                  Are you at {occurrence.title}?
                </Text>
                <Text tone="ink2">{[occurrence.club?.name, occurrence.place, occurrence.whenLabel].filter(Boolean).join(' · ')}</Text>
                {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
                <View style={styles.actions}>
                  <Button title="Check in" icon="checkCircle" onPress={() => void checkIn()} loading={busy} />
                  <Button title="Not now" variant="ghost" onPress={() => onClose(false)} accessibilityHint="Closes this so you can use the club page" />
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.lg + 4, borderTopRightRadius: radius.lg + 4, maxHeight: '90%', width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  grabber: { width: 40, height: 5, borderRadius: 3, alignSelf: 'center', marginTop: space.sm },
  content: { padding: space.lg, gap: space.sm },
  kicker: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actions: { gap: space.sm, marginTop: space.md },
});
