import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ApiError, errorMessage } from '@/api/client';
import { Api } from '@/api/endpoints';
import type { MCheckinCandidate } from '@/api/types';
import { useSession } from '@/auth/session';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/ClubLogo';
import { Icon } from '@/components/Icon';
import { listContent } from '@/components/Screen';
import { SignInPrompt } from '@/components/SignInPrompt';
import { InlineNotice, LoadingView } from '@/components/States';
import { Text } from '@/components/Text';
import { goBackOrHome } from '@/lib/nav';
import { invalidateApi } from '@/lib/use-api';
import { radius, space, TAP, useColors } from '@/theme';

type Notice = { tone: 'success' | 'danger'; text: string } | null;

export default function AddSomeoneScreen() {
  const { status, user } = useSession();
  if (status === 'loading') return <LoadingView />;
  if (!user) return <SignInPrompt icon="join" title="Add someone" body="Sign in as a club leader to check people in by hand." />;
  return <AddSomeone />;
}

/**
 * Check in someone who was there but couldn't scan (no phone, dead
 * battery). Searches the host club's members first, then any Weber State
 * account, and records the check-in as "Added by a leader" through the
 * Attendance Tool's manual add. Leaders with the Attendance permission only;
 * the server says no to everyone else.
 */
function AddSomeone() {
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const c = useColors();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MCheckinCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [checkedIn, setCheckedIn] = useState<number | null>(null);
  const term = query.trim();

  // Search as you type (2+ characters); an older search's answer never replaces a newer one's.
  useEffect(() => {
    if (term.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await Api.checkinPeople(String(id), term, controller.signal);
        if (controller.signal.aborted) return;
        setResults(r.items);
        setNotice((n) => (n?.tone === 'danger' ? null : n));
      } catch (e) {
        if (controller.signal.aborted) return;
        setNotice({ tone: 'danger', text: errorMessage(e) });
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [term, id]);

  const markIn = (personId: string) => setResults((list) => list?.map((x) => (x.id === personId ? { ...x, alreadyIn: true } : x)) ?? null);

  const add = async (p: MCheckinCandidate) => {
    setAddingId(p.id);
    setNotice(null);
    try {
      const r = await Api.addCheckin(String(id), p.id);
      markIn(p.id);
      setCheckedIn(r.checkedIn);
      setNotice({ tone: 'success', text: `${r.name} is checked in (${r.methodLabel}).${r.requirementsMet.length ? ` This counts for ${r.requirementsMet.join(', ')}.` : ''}` });
      invalidateApi();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CONFLICT') markIn(p.id);
      setNotice({ tone: 'danger', text: errorMessage(e) });
    } finally {
      setAddingId(null);
    }
  };

  return (
    <View style={[styles.flex, { backgroundColor: c.background }]}>
      <Stack.Screen options={{ headerRight: () => <Button title="Done" variant="ghost" compact onPress={goBackOrHome} /> }} />
      <View style={[styles.top, { borderBottomColor: c.line }]}>
        {title ? (
          <Text variant="label" numberOfLines={2}>
            {title}
          </Text>
        ) : null}
        <Text variant="small" tone="ink2">
          For people who were there but can&apos;t scan: no phone, dead battery. They&apos;re checked in as “Added by a leader”.
        </Text>
        <View style={[styles.search, { backgroundColor: c.surfaceAlt }]}>
          <Icon name="search" size={18} color={c.ink3} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Name or @mail.weber.edu email"
            placeholderTextColor={c.ink3}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
            accessibilityLabel="Find a person"
            accessibilityHint="Club members show first"
            style={[styles.input, { color: c.ink }]}
          />
        </View>
        <Text variant="caption" tone="ink3">
          Members of the club show first. Anyone with a Weber State account can be added.
        </Text>
        {notice ? <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice> : null}
        {checkedIn != null ? (
          <Text variant="small" tone="ink2" accessibilityLiveRegion="polite">
            {checkedIn} checked in so far.
          </Text>
        ) : null}
      </View>
      <FlatList
        data={results ?? []}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={listContent}
        ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.line }]} />}
        ListEmptyComponent={
          term.length >= 2 ? (
            <Text tone="ink3" style={styles.empty} accessibilityLiveRegion="polite">
              {searching || !results ? 'Searching…' : `Nobody matches “${term}”. Try part of their name or email.`}
            </Text>
          ) : undefined
        }
        renderItem={({ item }) => <PersonRow person={item} adding={addingId === item.id} disabled={addingId !== null} onAdd={() => void add(item)} />}
      />
    </View>
  );
}

function PersonRow({ person, adding, disabled, onAdd }: { person: MCheckinCandidate; adding: boolean; disabled: boolean; onAdd: () => void }) {
  const c = useColors();
  return (
    <View style={styles.row}>
      <Avatar name={person.name} url={person.avatarUrl} color={person.avatarColor} size={40} />
      <View style={styles.flex}>
        <View style={styles.nameRow}>
          <Text variant="label" numberOfLines={1} style={styles.shrink}>
            {person.name}
          </Text>
          {person.isMember ? <Badge label="Member" tone="brand" /> : null}
        </View>
        <Text variant="small" tone="ink3" numberOfLines={1}>
          {person.email}
        </Text>
      </View>
      {person.alreadyIn ? (
        <View style={styles.inRow} accessible accessibilityLabel={`${person.name} is checked in`}>
          <Icon name="checkCircle" size={18} color={c.success} />
          <Text variant="small" tone="success">
            Checked in
          </Text>
        </View>
      ) : (
        <Button title="Add" icon="join" variant="secondary" compact loading={adding} disabled={disabled && !adding} onPress={onAdd} accessibilityHint={`Checks in ${person.name}`} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  top: { gap: space.sm, padding: space.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.md, paddingHorizontal: space.md, minHeight: TAP - 4, marginTop: space.xs },
  input: { flex: 1, fontSize: 16, paddingVertical: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  shrink: { flexShrink: 1 },
  inRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 72 },
  empty: { padding: space.lg },
});
