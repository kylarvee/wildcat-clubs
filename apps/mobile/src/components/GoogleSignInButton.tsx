import { useEffect } from 'react';
import * as Google from 'expo-auth-session/providers/google';
import { GOOGLE_IDS } from '@/config';
import { Button } from '@/components/Button';

/**
 * "Continue with Weber State Google" through expo-auth-session. Gets a Google
 * ID token and hands it to onIdToken; the server checks it's a verified
 * @mail.weber.edu / @weber.edu account. Only mounted when this platform has a
 * client id (the hook throws without one).
 */
export function GoogleSignInButton({ onIdToken, onError, busy }: { onIdToken: (idToken: string) => void; onError: (message: string) => void; busy: boolean }) {
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    iosClientId: GOOGLE_IDS.ios || undefined,
    androidClientId: GOOGLE_IDS.android || undefined,
    webClientId: GOOGLE_IDS.web || undefined,
    selectAccount: true,
  });

  useEffect(() => {
    if (!response) return;
    if (response.type === 'success') {
      const idToken = response.params.id_token ?? response.authentication?.idToken;
      if (idToken) onIdToken(idToken);
      else onError("Google didn't send back a sign-in token. Please try again.");
    } else if (response.type === 'error') {
      onError(response.error?.message || 'Google sign-in failed. Please try again.');
    }
  }, [response, onIdToken, onError]);

  return (
    <Button
      title="Continue with Weber State Google"
      icon="person"
      onPress={() => void promptAsync()}
      disabled={!request}
      loading={busy}
      accessibilityHint="Opens Google to sign in with your Weber State account"
    />
  );
}
