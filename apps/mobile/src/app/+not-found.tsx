import { Stack, router } from 'expo-router';
import { ScrollScreen } from '@/components/Screen';
import { EmptyView } from '@/components/States';

/** A link the app doesn't know (an old or mistyped one). */
export default function NotFound() {
  return (
    <ScrollScreen>
      <Stack.Screen options={{ title: 'Not found' }} />
      <EmptyView icon="warning" title="We couldn't find that page" body="The link may be old. Everything else is a tap away." action="Go home" onAction={() => router.replace('/')} />
    </ScrollScreen>
  );
}
