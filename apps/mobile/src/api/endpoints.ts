import { api } from '@/api/client';
import type {
  MAnnouncementPage,
  MAttendance,
  MAuthOptions,
  MCalendar,
  MCheckinCandidates,
  MCheckinPreview,
  MCheckinQr,
  MCheckinRequest,
  MCheckinResult,
  MClubActionResponse,
  MClubDetail,
  MClubList,
  MDecisionResponse,
  MEventDetail,
  MEventFilter,
  MHome,
  MManualCheckinResult,
  MMe,
  MNotifications,
  MPushTokenRequest,
  MPushTokenResponse,
  MReadRequest,
  MReadResponse,
  MSession,
  MSignOutResponse,
  MTaskDecision,
  MTaskDoneResponse,
  MTasks,
} from '@/api/types';

const DECISION_PATH: Record<MTaskDecision['kind'], string> = { JOIN: 'join-requests', COHOST: 'cohost-requests' };

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
  announcements: (cursor: string, limit = 10) => api<MAnnouncementPage>(`/announcements?cursor=${encodeURIComponent(cursor)}&limit=${limit}`),
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
  /** The Events tab: everything you may see, one filter at a time ("following" = your calendar). Works signed out. */
  events: (filter: MEventFilter, from?: string, to?: string) => {
    const q = new URLSearchParams();
    if (filter !== 'all') q.set('filter', filter);
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    const qs = q.toString();
    return api<MCalendar>(`/events${qs ? `?${qs}` : ''}`);
  },
  notifications: () => api<MNotifications>('/notifications'),
  markRead: (body: MReadRequest) => api<MReadResponse>('/notifications/read', { method: 'POST', body }),
  attendance: () => api<MAttendance>('/attendance'),

  tasks: () => api<MTasks>('/tasks'),
  setTaskDone: (taskId: string, done: boolean) => api<MTaskDoneResponse>(`/tasks/${encodeURIComponent(taskId)}/done`, { method: 'POST', body: { done } }),
  /** Approve or decline a join request or co-host invitation from Tasks. */
  decide: (d: Pick<MTaskDecision, 'kind' | 'id'>, approve: boolean) =>
    api<MDecisionResponse>(`/${DECISION_PATH[d.kind]}/${encodeURIComponent(d.id)}/${approve ? 'approve' : 'decline'}`, { method: 'POST' }),

  // Leader check-in tools (Attendance permission in the host club).
  checkinQr: (occurrenceId: string) => api<MCheckinQr>(`/checkin/${encodeURIComponent(occurrenceId)}/qr`),
  checkinPeople: (occurrenceId: string, q: string, signal?: AbortSignal) =>
    api<MCheckinCandidates>(`/checkin/${encodeURIComponent(occurrenceId)}/people?q=${encodeURIComponent(q)}`, { signal }),
  addCheckin: (occurrenceId: string, userId: string) => api<MManualCheckinResult>(`/checkin/${encodeURIComponent(occurrenceId)}/people`, { method: 'POST', body: { userId } }),
};
