import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { MCheckinResult } from '@/api/types';
import { radius, space, useColors } from '@/theme';
import { campusTime, possessive } from '@/lib/format';
import { openWeb } from '@/lib/links';
import { Button } from '@/components/Button';
import { Icon, type IconName } from '@/components/Icon';
import { ProgressBar } from '@/components/ProgressBar';
import { Text } from '@/components/Text';

function Line({ icon, tone = 'brand', children }: { icon: IconName; tone?: 'brand' | 'success' | 'warning'; children: ReactNode }) {
  const c = useColors();
  const colors = { brand: [c.brandTint, c.brandText], success: [c.successTint, c.success], warning: [c.warningTint, c.warning] }[tone];
  return (
    <View style={[styles.line, { backgroundColor: colors[0] }]}>
      <Icon name={icon} size={20} color={colors[1]} />
      <View style={styles.lineBody}>{children}</View>
    </View>
  );
}

/** What happened when you checked in: the confirmation, membership news, review progress, requirements met. */
export function CheckinResultView({ result, onDone, onViewClub }: { result: MCheckinResult; onDone: () => void; onViewClub?: () => void }) {
  const c = useColors();
  const club = result.club;
  const already = result.status === 'ALREADY';
  const review = result.reviewProgress;
  const showReview = Boolean(review && club && (!review.eligible || review.attended === review.required));
  const hasNews = (club && (result.membership === 'JOINED' || result.membership === 'REQUESTED')) || result.requirementsMet.length > 0 || showReview;
  return (
    <View style={styles.wrap}>
      <View style={styles.hero} accessible accessibilityRole="header" accessibilityLabel={already ? `You're already checked in to ${result.occurrence.title}` : `You're checked in to ${result.occurrence.title}`}>
        <View style={[styles.badge, { backgroundColor: c.successTint }]}>
          <Icon name="checkCircle" size={56} color={c.success} />
        </View>
        <Text variant="display" style={styles.center}>
          {already ? "You're already checked in" : "You're checked in!"}
        </Text>
        <Text variant="heading" style={styles.center}>
          {result.occurrence.title}
        </Text>
        <Text tone="ink2" style={styles.center}>
          {[club?.name ?? 'Weber State', result.occurrence.place].filter(Boolean).join(' · ')}
        </Text>
        <Text variant="small" tone="ink3" style={styles.center}>
          {already ? `Checked in at ${campusTime(result.checkedInAt)} · ${result.methodLabel}` : `${campusTime(result.checkedInAt)} · ${result.methodLabel}`}
        </Text>
      </View>

      {hasNews ? (
        <View style={styles.lines}>
          {result.membership === 'JOINED' && club ? (
            <Line icon="celebrate" tone="success">
              <Text variant="label">Welcome to {club.name}!</Text>
              <Text variant="small" tone="ink2">
                You&apos;re a member now, and the club&apos;s events are on your calendar.
              </Text>
            </Line>
          ) : null}
          {result.membership === 'REQUESTED' && club ? (
            <Line icon="pending" tone="warning">
              <Text variant="label">Join request sent</Text>
              <Text variant="small" tone="ink2">
                {possessive(club.name)} leaders approve new members. Your check-in counts either way.
              </Text>
            </Line>
          ) : null}
          {result.requirementsMet.length ? (
            <Line icon="checkCircle" tone="success">
              <Text variant="label">Requirement complete</Text>
              <Text variant="small" tone="ink2">
                This counts for {result.requirementsMet.join(', ')}.
              </Text>
            </Line>
          ) : null}
          {/* Review progress until it unlocks, and the news on the check-in that unlocks it. */}
          {review && club && showReview ? (
            review.eligible ? (
              <Line icon="star" tone="success">
                <Text variant="label">You can now review {club.name}</Text>
                <Text variant="small" tone="ink2">
                  You&apos;ve been to {review.attended} events. Tell other Wildcats what it&apos;s like.
                </Text>
                <Button title="Write a review" variant="ghost" compact icon="external" onPress={() => void openWeb(`/clubs/${club.slug}#reviews`)} style={styles.inlineButton} />
              </Line>
            ) : (
              <Line icon="star">
                <Text variant="label">
                  {review.attended} of {review.required} events toward a review
                </Text>
                <ProgressBar value={review.attended / Math.max(1, review.required)} label={`${review.attended} of ${review.required} events toward leaving a review`} />
              </Line>
            )
          ) : null}
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button title="Done" onPress={onDone} />
        {club && onViewClub ? <Button title={`Open ${club.name}`} variant="ghost" onPress={onViewClub} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xl },
  hero: { alignItems: 'center', gap: space.sm, paddingTop: space.lg },
  badge: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  center: { textAlign: 'center' },
  lines: { gap: space.sm },
  line: { flexDirection: 'row', gap: space.md, padding: space.md, borderRadius: radius.md },
  lineBody: { flex: 1, gap: 6 },
  inlineButton: { alignSelf: 'flex-start', marginTop: 4 },
  actions: { gap: space.sm },
});
