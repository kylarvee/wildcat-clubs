import { router } from 'expo-router';

/** Back to the Home tab, closing any screens stacked on top (after a check-in). */
export function goHome() {
  if (router.canDismiss()) router.dismissAll();
  router.navigate('/');
}

/** Back if there's somewhere to go back to, else Home. */
export function goBackOrHome() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}
