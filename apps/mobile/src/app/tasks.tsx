import { useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { errorMessage } from '@/api/client';
import { Api } from '@/api/endpoints';
import type { MTask, TaskKind } from '@/api/types';
import { useSession } from '@/auth/session';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Checkbox } from '@/components/Checkbox';
import { Icon, type IconName } from '@/components/Icon';
import { listContent } from '@/components/Screen';
import { SignInPrompt } from '@/components/SignInPrompt';
import { EmptyView, ErrorView, InlineNotice, LoadingView } from '@/components/States';
import { Text } from '@/components/Text';
import { confirmAsync } from '@/lib/confirm';
import { plural, possessive } from '@/lib/format';
import { openHref, openWeb, routeForHref } from '@/lib/links';
import { invalidateApi, useApi } from '@/lib/use-api';
import { space, useColors } from '@/theme';

type Tone = 'brand' | 'warning' | 'danger' | 'neutral';
/** The web's badge colors (components/tasks/labels KIND_TONE); its "info" is brand here. */
const KIND_TONE: Record<TaskKind, Tone> = { APPROVAL: 'warning', REQUIREMENT: 'danger', TEST: 'brand', INVOICE: 'brand', CLUB: 'brand', PERSONAL: 'neutral' };
const KIND_ICON: Record<TaskKind, IconName> = { APPROVAL: 'pending', REQUIREMENT: 'warning', TEST: 'tasks', INVOICE: 'info', CLUB: 'tasks', PERSONAL: 'tasks' };

/** What happened to a row on this screen, until the list reloads. */
type RowState = { busy?: 'approve' | 'decline' | 'done'; done?: boolean; outcome?: { tone: 'success' | 'danger'; text: string } };

export default function TasksScreen() {
  const { status, user } = useSession();
  if (status === 'loading') return <LoadingView />;
  if (!user) return <SignInPrompt icon="tasks" title="Your tasks" body="Sign in to see requests waiting for your approval, what WSUSA requires of you, and your to-dos." />;
  return <Tasks userId={user.id} />;
}

/**
 * Everything waiting on you: the web's Tasks list, what WSUSA requires
 * first. Join requests and co-host invitations are decided right here,
 * personal and club to-dos are checked off, and the rest open where they're
 * done (a test, a form, an invoice): in the app when it has the screen,
 * else on the web.
 */
function Tasks({ userId }: { userId: string }) {
  const c = useColors();
  const { refreshMe } = useSession();
  const { data, error, loading, refreshing, refresh, reload } = useApi(`tasks:${userId}`, Api.tasks, { staleMs: 15_000 });
  const [rows, setRows] = useState<Record<string, RowState>>({});

  const patch = (id: string, next: RowState) => setRows((r) => ({ ...r, [id]: { ...r[id], ...next } }));
  // Home's Tasks row and the badges catch up.
  const changed = () => {
    invalidateApi();
    void refreshMe();
  };

  const decide = async (t: MTask, approve: boolean) => {
    if (!t.decision) return;
    const [title, message, label] = confirmCopy(t, approve);
    if (!(await confirmAsync(title, message, label, !approve))) return;
    patch(t.id, { busy: approve ? 'approve' : 'decline', outcome: undefined });
    try {
      const r = await Api.decide(t.decision, approve);
      patch(t.id, { busy: undefined, outcome: { tone: 'success', text: r.message } });
      changed();
    } catch (e) {
      patch(t.id, { busy: undefined, outcome: { tone: 'danger', text: errorMessage(e) } });
    }
  };

  const toggle = async (t: MTask, done: boolean) => {
    patch(t.id, { busy: 'done', done, outcome: undefined });
    try {
      await Api.setTaskDone(t.id, done);
      patch(t.id, { busy: undefined });
      changed();
    } catch (e) {
      patch(t.id, { busy: undefined, done: !done, outcome: { tone: 'danger', text: errorMessage(e) } });
    }
  };

  if (loading && !data) return <LoadingView label="Loading your tasks" />;
  if (!data) return <ErrorView error={error} onRetry={reload} />;

  const required = data.items.filter((t) => t.required);
  const others = data.items.filter((t) => !t.required);
  const overdue = data.items.filter((t) => t.overdue).length;
  const sections = [
    ...(required.length ? [{ key: 'required', data: required }] : []),
    ...(others.length ? [{ key: 'others', data: others }] : []),
  ];

  return (
    <SectionList
      style={{ backgroundColor: c.background }}
      sections={sections}
      keyExtractor={(t) => t.id}
      contentContainerStyle={listContent}
      stickySectionHeadersEnabled={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRows({});
            void refresh();
          }}
          tintColor={c.brandText}
          colors={[c.brand]}
        />
      }
      ListHeaderComponent={
        <View style={styles.pad}>
          {error ? <InlineNotice error={error} /> : null}
          {data.items.length ? (
            <Text tone="ink2" accessibilityRole="summary">
              {plural(data.items.length, 'open task')}
              {required.length ? ` · ${required.length} required` : ''}
              {overdue ? ` · ${overdue} overdue` : ''}
            </Text>
          ) : null}
        </View>
      }
      renderSectionHeader={({ section }) =>
        section.key === 'required' ? (
          <View style={[styles.sectionHead, styles.pad]}>
            <View style={styles.requiredTitle}>
              <Icon name="warning" size={18} color={c.danger} />
              <Text variant="heading" accessibilityRole="header" style={{ color: c.danger }}>
                Required by WSUSA
              </Text>
            </View>
            <Text variant="small" tone="ink2">
              Each one closes on its own once it&apos;s done. If one that comes with a club role goes overdue, your permissions in that club pause until you finish it. Your title stays.
            </Text>
          </View>
        ) : (
          <View style={[styles.sectionHead, styles.pad]}>
            <Text variant="heading" accessibilityRole="header">
              {required.length ? 'Other open tasks' : 'Open tasks'}
            </Text>
          </View>
        )
      }
      ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.line }]} />}
      renderItem={({ item }) => <TaskRow task={item} state={rows[item.id] ?? {}} onDecide={(approve) => void decide(item, approve)} onToggle={(done) => void toggle(item, done)} />}
      ListEmptyComponent={
        <View style={styles.pad}>
          <EmptyView icon="checkCircle" title="You're all caught up" body="Nothing is waiting on you. Join requests, what WSUSA requires and tasks from your clubs show up here." />
        </View>
      }
      ListFooterComponent={
        <View style={[styles.pad, styles.footer]}>
          {data.more ? (
            <Text variant="small" tone="ink3">
              Showing your first {data.items.length} open tasks, required first, then soonest due. The web lists them all.
            </Text>
          ) : null}
          <Text variant="small" tone="ink3">
            Finished tasks, tasks you&apos;ve assigned and adding a to-do of your own are on the web.
          </Text>
          <Button title="Open Tasks on the web" variant="ghost" icon="external" compact onPress={() => void openWeb('/tasks')} style={styles.alignStart} />
        </View>
      }
    />
  );
}

function TaskRow({ task, state, onDecide, onToggle }: { task: MTask; state: RowState; onDecide: (approve: boolean) => void; onToggle: (done: boolean) => void }) {
  const c = useColors();
  const done = Boolean(state.done);
  const decided = Boolean(task.decision && state.outcome?.tone === 'success');
  const opensInApp = task.path ? Boolean(routeForHref(task.path)) : false;
  const who = task.decision?.kind === 'JOIN' ? task.decision.personName : task.decision ? task.decision.eventTitle : '';
  return (
    <View style={styles.row}>
      <View style={styles.lead}>
        {task.checkable ? (
          <Checkbox checked={done} onChange={onToggle} disabled={state.busy === 'done'} label={done ? `Mark “${task.title}” as not done` : `Mark “${task.title}” done`} />
        ) : (
          <Icon name={task.required ? 'warning' : KIND_ICON[task.kind]} size={20} color={task.required ? c.danger : c.ink3} />
        )}
      </View>
      <View style={styles.body}>
        <Text variant="label" style={done ? [styles.doneText, { color: c.ink3 }] : undefined}>
          {task.title}
        </Text>
        {task.description ? (
          <Text variant="small" tone="ink2" numberOfLines={4}>
            {task.description}
          </Text>
        ) : null}
        <View style={styles.meta}>
          <Badge label={task.badge} tone={task.required ? 'danger' : KIND_TONE[task.kind]} />
          {task.club ? (
            <Text variant="caption" tone="ink3" numberOfLines={1} style={styles.shrink}>
              {task.club.name}
            </Text>
          ) : null}
        </View>
        {task.waitingLabel || task.dueLabel || task.fromLabel || task.forGroup ? (
          <View style={styles.meta}>
            {task.waitingLabel ? (
              <Text variant="caption" tone="brand">
                {task.waitingLabel}
              </Text>
            ) : task.dueLabel ? (
              <Text variant="caption" tone={task.overdue ? 'danger' : task.dueSoon ? 'warning' : 'ink3'}>
                {task.dueLabel}
              </Text>
            ) : null}
            {task.fromLabel ? (
              <Text variant="caption" tone="ink3">
                {task.fromLabel}
              </Text>
            ) : null}
            {task.forGroup ? (
              <Text variant="caption" tone="ink3">
                {task.forGroup}
              </Text>
            ) : null}
          </View>
        ) : null}
        {task.note && !state.outcome ? (
          <Text variant="caption" tone="ink3">
            {task.note}
          </Text>
        ) : null}
        {state.outcome ? (
          <View style={styles.outcome}>
            <InlineNotice tone={state.outcome.tone}>{state.outcome.text}</InlineNotice>
          </View>
        ) : null}
        {task.decision && !decided ? (
          <View style={styles.actions}>
            <Button title="Decline" variant="danger" compact onPress={() => onDecide(false)} loading={state.busy === 'decline'} disabled={Boolean(state.busy)} accessibilityHint={`Declines ${who}`} style={styles.grow} />
            <Button title="Approve" icon="check" compact onPress={() => onDecide(true)} loading={state.busy === 'approve'} disabled={Boolean(state.busy)} accessibilityHint={`Approves ${who}`} style={styles.grow} />
          </View>
        ) : !task.decision && task.path ? (
          <Button
            title={opensInApp ? 'Open' : 'Open on the web'}
            variant="ghost"
            icon={opensInApp ? 'arrow' : 'external'}
            compact
            onPress={() => openHref(task.path)}
            accessibilityHint={opensInApp ? undefined : 'You may need to sign in there.'}
            style={styles.alignStart}
          />
        ) : null}
      </View>
    </View>
  );
}

/** The question before deciding: who it's about and who hears about it (lib/domain/memberships and events notify them). */
function confirmCopy(t: MTask, approve: boolean): [title: string, message: string, label: string] {
  const d = t.decision!;
  if (d.kind === 'JOIN') {
    return approve
      ? [`Approve ${d.personName}?`, `They join ${d.clubName} right away, and its events go on their calendar. They'll get a notification.`, 'Approve']
      : [`Decline ${d.personName}?`, `Their request to join ${d.clubName} won't be approved. They'll get a notification.`, 'Decline'];
  }
  return approve
    ? [`Co-host “${d.eventTitle}”?`, `It goes on ${possessive(d.clubName)} calendar, and ${d.hostName} hears that you're in.`, 'Approve']
    : ['Decline to co-host?', `“${d.eventTitle}” stays off ${possessive(d.clubName)} calendar, and ${d.hostName} hears that you declined.`, 'Decline'];
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: space.lg },
  sectionHead: { paddingTop: space.lg, paddingBottom: space.sm, gap: space.xs },
  requiredTitle: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  row: { flexDirection: 'row', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  lead: { width: 32, alignItems: 'center', paddingTop: 1 },
  body: { flex: 1, gap: 6 },
  doneText: { textDecorationLine: 'line-through' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  shrink: { flexShrink: 1 },
  outcome: { marginTop: space.xs, marginBottom: -space.md },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
  grow: { flexGrow: 1, flexBasis: 0 },
  alignStart: { alignSelf: 'flex-start' },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 64 },
  footer: { gap: space.sm, paddingTop: space.xl },
});
