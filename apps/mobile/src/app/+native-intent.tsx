import type { NativeIntent } from 'expo-router';

/**
 * Links the system hands to the app, before the router opens them as screens.
 *
 * Google sign-in on Android comes back as `<package>:/oauthredirect?code=…`.
 * expo-auth-session reads that link itself; if the router also opened it,
 * "not found" would land on top of the sign-in screen and stay there after
 * signing in. So the router ignores it (or starts at Home if it launched the app).
 */
export const redirectSystemPath: NativeIntent['redirectSystemPath'] = ({ path, initial }) => {
  if (path.includes('oauthredirect')) return initial ? '/' : null;
  return path;
};
