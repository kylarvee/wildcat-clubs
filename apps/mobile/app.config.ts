import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * app.json, plus the EAS project id that push notifications need (Expo push
 * tokens belong to a project). Set it once, either way:
 *  - EXPO_PUBLIC_EAS_PROJECT_ID in apps/mobile/.env.local (git ignores it) or
 *    as an EAS environment variable for builds, or
 *  - expo.extra.eas.projectId in app.json.
 * The environment wins when both are set. src/lib/push.ts reads the result
 * (README → Push notifications has the one-time setup).
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim() || config.extra?.eas?.projectId;
  const eas = projectId ? { ...config.extra?.eas, projectId } : config.extra?.eas;
  return {
    ...config,
    name: config.name ?? 'Wildcat Clubs',
    slug: config.slug ?? 'wildcat-clubs',
    extra: { ...config.extra, ...(eas ? { eas } : {}) },
  };
};
