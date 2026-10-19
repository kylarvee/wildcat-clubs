import { SymbolView } from 'expo-symbols';
import type { SFSymbol } from 'sf-symbols-typescript';
import type { ComponentProps } from 'react';
import type { ColorValue, StyleProp, ViewStyle } from 'react-native';

/**
 * Icons by meaning, not by font: SF Symbols on iOS, Material Symbols on
 * Android and the web (both ship with expo-symbols). Decorative by default —
 * the button or row around an icon carries the label.
 */
type Material = Extract<ComponentProps<typeof SymbolView>['name'], { android?: unknown }>['android'];

const ICONS = {
  home: { ios: 'house', android: 'home' },
  scan: { ios: 'qrcode.viewfinder', android: 'qr_code_scanner' },
  clubs: { ios: 'person.3', android: 'groups' },
  calendar: { ios: 'calendar', android: 'calendar_month' },
  inbox: { ios: 'tray', android: 'inbox' },
  me: { ios: 'person.crop.circle', android: 'account_circle' },
  search: { ios: 'magnifyingglass', android: 'search' },
  check: { ios: 'checkmark', android: 'check' },
  checkCircle: { ios: 'checkmark.circle.fill', android: 'check_circle' },
  chevron: { ios: 'chevron.right', android: 'chevron_right' },
  close: { ios: 'xmark', android: 'close' },
  place: { ios: 'mappin.and.ellipse', android: 'location_on' },
  time: { ios: 'clock', android: 'schedule' },
  signOut: { ios: 'rectangle.portrait.and.arrow.right', android: 'logout' },
  external: { ios: 'arrow.up.right.square', android: 'open_in_new' },
  offline: { ios: 'wifi.slash', android: 'wifi_off' },
  warning: { ios: 'exclamationmark.triangle', android: 'error' },
  info: { ios: 'info.circle', android: 'info' },
  keyboard: { ios: 'keyboard', android: 'keyboard' },
  torchOn: { ios: 'flashlight.on.fill', android: 'flashlight_on' },
  torchOff: { ios: 'flashlight.off.fill', android: 'flashlight_off' },
  star: { ios: 'star.fill', android: 'star' },
  bell: { ios: 'bell', android: 'notifications' },
  bellOff: { ios: 'bell.slash', android: 'notifications_off' },
  megaphone: { ios: 'megaphone', android: 'campaign' },
  live: { ios: 'dot.radiowaves.left.and.right', android: 'sensors' },
  join: { ios: 'person.badge.plus', android: 'person_add' },
  subscribe: { ios: 'calendar.badge.plus', android: 'event_available' },
  mail: { ios: 'envelope', android: 'mail' },
  web: { ios: 'globe', android: 'language' },
  history: { ios: 'clock.arrow.circlepath', android: 'history' },
  pending: { ios: 'hourglass', android: 'hourglass_top' },
  cancelled: { ios: 'calendar.badge.exclamationmark', android: 'event_busy' },
  video: { ios: 'video', android: 'videocam' },
  link: { ios: 'link', android: 'link' },
  celebrate: { ios: 'party.popper', android: 'celebration' },
  person: { ios: 'person', android: 'person' },
  qr: { ios: 'qrcode', android: 'qr_code_2' },
  readAll: { ios: 'checkmark.circle', android: 'done_all' },
  arrow: { ios: 'arrow.right', android: 'arrow_forward' },
  tasks: { ios: 'checklist', android: 'checklist' },
  box: { ios: 'square', android: 'check_box_outline_blank' },
  boxChecked: { ios: 'checkmark.square.fill', android: 'check_box' },
  refresh: { ios: 'arrow.clockwise', android: 'refresh' },
} satisfies Record<string, { ios: SFSymbol; android: Material }>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 22, color, style }: { name: IconName; size?: number; color: ColorValue; style?: StyleProp<ViewStyle> }) {
  const i = ICONS[name];
  return (
    <SymbolView
      name={{ ios: i.ios, android: i.android, web: i.android }}
      size={size}
      tintColor={color}
      style={style}
      accessible={false}
      importantForAccessibility="no"
      aria-hidden
    />
  );
}
