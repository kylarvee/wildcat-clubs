import type { ColorValue } from 'react-native';
import { Tabs } from 'expo-router/js-tabs';
import { useSession } from '@/auth/session';
import { Icon, type IconName } from '@/components/Icon';
import { useColors } from '@/theme';

function tabIcon(name: IconName) {
  // Tab icons are decorative; the tab's label is what screen readers announce.
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Icon name={name} color={color} size={size} />;
  }
  return TabIcon;
}

/** Six tabs: Home, Scan, Clubs, Events (the `calendar` route), Notifications (the `inbox` route), Me. */
export default function TabsLayout() {
  const c = useColors();
  const { me, status } = useSession();
  const unread = status === 'signedIn' ? (me?.unreadNotifications ?? 0) : 0;
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.brandText,
        tabBarInactiveTintColor: c.ink3,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.line },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        headerStyle: { backgroundColor: c.surface },
        headerTitleStyle: { color: c.ink, fontWeight: '700' },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: c.background },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          headerTitle: 'Wildcat Clubs',
          headerStyle: { backgroundColor: c.brand },
          headerTitleStyle: { color: c.onBrand, fontWeight: '700' },
          tabBarIcon: tabIcon('home'),
        }}
      />
      <Tabs.Screen name="scan" options={{ title: 'Scan', headerTitle: 'Scan to check in', tabBarIcon: tabIcon('scan') }} />
      <Tabs.Screen name="clubs" options={{ title: 'Clubs', tabBarIcon: tabIcon('clubs') }} />
      <Tabs.Screen name="calendar" options={{ title: 'Events', headerTitle: 'Events', tabBarIcon: tabIcon('calendar') }} />
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Notifications',
          tabBarIcon: tabIcon('bell'),
          tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined,
          tabBarAccessibilityLabel: unread > 0 ? `Notifications, ${unread} unread` : 'Notifications',
        }}
      />
      <Tabs.Screen name="me" options={{ title: 'Me', tabBarIcon: tabIcon('me') }} />
    </Tabs>
  );
}
