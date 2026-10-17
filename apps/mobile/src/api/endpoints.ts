import { api } from '@/api/client';
import type {
  MAttendance,
  MAuthOptions,
  MCalendar,
  MCheckinPreview,
  MCheckinRequest,
  MCheckinResult,
  MClubActionResponse,
  MClubDetail,
  MClubList,
  MEventDetail,
  MHome,
  MMe,
  MNotifications,
  MPushTokenRequest,
  MPushTokenResponse,
  MReadRequest,
  MReadResponse,
  MSession,
  MSignOutResponse,
} from '@/api/types';

/** Every call the app makes, typed against the shared contract (api/types). */
export const Api = {
  authOptions: () => api<MAuthOptions>('/auth/personas', { token: null }),
  signInPersona: (key: string) => api<MSession>('/auth/persona', { method: 'POST', body: { key }, token: null }),
  signInGoogle: (idToken: string) => api<MSession>('/auth/google', { method: 'POST', body: { idToken }, token: null }),
  signOut: (token: string, pushToken: string | null) => api<MSignOutResponse>('/auth/signout', { method: 'POST', body: { pushToken }, token }),

  me: () => api<MMe>('/me'),
  registerPush: (body: MPushTokenRequest) => api<MPushTokenResponse>('/push-token', { method: 'POST', body }),
  removePush: (token: string) => api<MPushTokenResponse>('/push-token', { method: 'DELETE', body: { token } }),

  home: () => api<MHome>('/home'),
  clubs: (q: string) => api<MClubList>(`/clubs${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  club: (slug: string) => api<MClubDetail>(`/clubs/${encodeURIComponent(slug)}`),
  clubAction: (slug: string, action: 'join' | 'leave' | 'subscribe' | 'unsubscribe') =>
    api<MClubActionResponse>(`/clubs/${encodeURIComponent(slug)}/${action}`, { method: 'POST' }),
  event: (occurrenceId: string) => api<MEventDetail>(`/events/${encodeURIComponent(occurrenceId)}`),

  checkinPreview: (body: MCheckinRequest) => api<MCheckinPreview>('/checkin/preview', { method: 'POST', body }),
  checkIn: (body: MCheckinRequest) => api<MCheckinResult>('/checkin', { method: 'POST', body }),

  calendar: (from?: string, to?: string) => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    const qs = q.toString();
    return api<MCalendar>(`/calendar${qs ? `?${qs}` : ''}`);
  },
  notifications: () => api<MNotifications>('/notifications'),
  markRead: (body: MReadRequest) => api<MReadResponse>('/notifications/read', { method: 'POST', body }),
  attendance: () => api<MAttendance>('/attendance'),
};
