/**
 * Every ActivityLog action, once. Pure and client-safe: each entry says what
 * the action is called on admin screens ("Assigned a role"), how a feed says
 * it after the actor's name ("filled the Treasurer seat"), and whether its
 * rows are public by default.
 *
 * Readers: the profile feed (lib/profiles/activity), a club's Recent activity
 * (components/founding/ActivityFeed), the admin Overview (lib/analytics/admin)
 * and People (components/admin/users/labels). logActivity uses `public` when
 * a call site doesn't say; a call site may still decide per row (a public
 * event, an approval). actions.test.ts fails on any action written without an
 * entry here, on entries nothing writes, and on call sites whose literal
 * isPublic disagrees with this catalog.
 *
 * Phrases are written for a club's own feed, where the club is implied
 * ("approved the club"); the admin Overview shows the club's name beside them.
 * Never put anonymous-complaint details here.
 */

type Data = Record<string, unknown>;

/** Words the catalog can't import (role names live in lib/authz, which is server-only). */
export type PhraseWords = { role: (role: unknown) => string | null };

export type ActionEntry = {
  /** People's activity list and other admin screens: "Assigned a role". */
  label: string;
  /** After the actor's name in a feed: "filled the Treasurer seat". */
  phrase: string | ((d: Data, w: PhraseWords) => string);
  /** Rows are public (profiles, club pages, the admin Overview) unless the call site decides otherwise. */
  public: boolean;
  /** Busy and low-signal: left out of the club and admin feeds. */
  busy?: true;
};

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
/** `yes(value)` when the field has text, else `no`. */
const q = (v: unknown, yes: (s: string) => string, no: string) => {
  const s = text(v);
  return s ? yes(s) : no;
};
const an = (word: string) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);

export const ACTIONS = {
  // ─── Advisors and ambassadors ──────────────────────────────────────────────
  "advisor.invited": { label: "Invited an advisor", phrase: (d) => q(d.name, (n) => `invited ${n} to advise the club`, "invited an advisor"), public: false },
  "advisor.invite_resent": { label: "Resent an advisor invitation", phrase: "resent an advisor invitation", public: false },
  "advisor.invite_cancelled": { label: "Cancelled an advisor invitation", phrase: "cancelled an advisor invitation", public: false },
  "advisor.accepted": { label: "Became a club advisor", phrase: "became the club's advisor", public: true },
  "advisor.declined": { label: "Declined to advise a club", phrase: "declined to advise the club", public: false },
  "ambassador.requested": { label: "Asked for a college ambassador", phrase: "asked the college's ambassador program for an ambassador", public: false },
  "ambassador.request_withdrawn": { label: "Withdrew an ambassador request", phrase: "withdrew the club's ambassador request", public: false },
  "ambassador.request_declined": { label: "Declined an ambassador request", phrase: "declined a club's request for an ambassador", public: false },
  "ambassador.placed": { label: "Placed a college ambassador", phrase: "placed a college ambassador in a club", public: false },
  "ambassador.placement_ended": { label: "Ended an ambassador placement", phrase: "ended an ambassador placement", public: false },
  "ambassador.advisor_set": { label: "Named an ambassador program's advisor", phrase: "named the program's advisor", public: false },

  // ─── Announcements ─────────────────────────────────────────────────────────
  /** Public only when the announcement is (the call site decides). */
  "announcement.created": { label: "Posted an announcement", phrase: (d) => q(d.title, (t) => `posted “${t}”`, "posted an announcement"), public: false },
  "announcement.updated": { label: "Edited an announcement", phrase: (d) => q(d.title, (t) => `edited the announcement “${t}”`, "edited an announcement"), public: false },
  "announcement.deleted": { label: "Deleted an announcement", phrase: (d) => q(d.title, (t) => `deleted the announcement “${t}”`, "deleted an announcement"), public: false },
  "announcement.pinned": { label: "Pinned an announcement", phrase: (d) => q(d.title, (t) => `pinned “${t}”`, "pinned an announcement"), public: false },
  "announcement.unpinned": { label: "Unpinned an announcement", phrase: (d) => q(d.title, (t) => `unpinned “${t}”`, "unpinned an announcement"), public: false },

  // ─── Attendance ────────────────────────────────────────────────────────────
  "attendance.checkin": { label: "Checked in to an event", phrase: (d) => q(d.title, (t) => `checked in to “${t}”`, "checked in to an event"), public: true, busy: true },
  "attendance.manual_add": { label: "Added a check-in by hand", phrase: "added someone's check-in by hand", public: false, busy: true },
  "attendance.removed": { label: "Removed a check-in", phrase: "removed a check-in", public: false },

  // ─── Budget and funding ────────────────────────────────────────────────────
  "budget.item_added": { label: "Added a budget cost", phrase: (d) => q(d.description, (t) => `added “${t}” to the budget`, "added a cost to the budget"), public: false },
  "budget.item_updated": { label: "Edited a budget cost", phrase: (d) => q(d.description, (t) => `edited the budget cost “${t}”`, "edited a budget cost"), public: false },
  "budget.item_removed": { label: "Removed a budget cost", phrase: (d) => q(d.description, (t) => `removed “${t}” from the budget`, "removed a budget cost"), public: false },
  "funding.draft_created": { label: "Started a funding request", phrase: (d) => q(d.title, (t) => `started the funding request “${t}”`, "started a funding request"), public: false },
  "funding.draft_updated": { label: "Edited a funding request draft", phrase: (d) => q(d.title, (t) => `edited the funding request draft “${t}”`, "edited a funding request draft"), public: false },
  "funding.draft_discarded": { label: "Discarded a funding request draft", phrase: (d) => q(d.title, (t) => `discarded the funding request draft “${t}”`, "discarded a funding request draft"), public: false },
  "funding.submitted": { label: "Submitted a funding request", phrase: (d) => q(d.title, (t) => `sent the funding request “${t}” to WSUSA`, "sent a funding request to WSUSA"), public: false },
  "funding.withdrawn": { label: "Withdrew a funding request", phrase: (d) => q(d.title, (t) => `withdrew the funding request “${t}”`, "withdrew a funding request"), public: false },
  "funding.approved": { label: "Approved a funding request", phrase: "approved a funding request", public: false },
  "funding.partially_approved": { label: "Partly approved a funding request", phrase: "partly approved a funding request", public: false },
  "funding.denied": { label: "Didn't approve a funding request", phrase: "didn't approve a funding request", public: false },
  "invoice.created": { label: "Created a funding invoice", phrase: (d) => q(d.number, (n) => `created invoice ${n}`, "created a funding invoice"), public: false },
  "invoice.processed": { label: "Marked a funding invoice processed", phrase: (d) => q(d.number, (n) => `marked invoice ${n} processed`, "marked a funding invoice processed"), public: false },

  // ─── Calendars (following a club's calendar) ───────────────────────────────
  "calendar.subscribed": { label: "Followed a club calendar", phrase: "followed the club's calendar", public: false, busy: true },
  "calendar.unsubscribed": { label: "Unfollowed a club calendar", phrase: "unfollowed the club's calendar", public: false, busy: true },
  "calendar.token_reset": { label: "Reset their private calendar feed link", phrase: "reset their private calendar feed link", public: false },

  // ─── Clubs ─────────────────────────────────────────────────────────────────
  "club.created": { label: "Started a club", phrase: "started the club", public: false },
  "club.profile_updated": { label: "Updated a club profile", phrase: "updated the club profile", public: false },
  "club.contact_email_set": { label: "Changed a club's Google account email", phrase: "changed the club's Google account email", public: false },
  "club.google_account_verified": { label: "Verified a club's Google account", phrase: "verified the club's Google account", public: false },
  "club.google_account_unverified": { label: "Withdrew a Google account verification", phrase: "withdrew the club's Google account verification", public: false },
  "club.cohost_auto_set": { label: "Changed co-host auto-approval", phrase: "changed co-host auto-approval", public: false },
  /** Public when the document is (the call site decides). */
  "club.document_added": { label: "Added a profile document", phrase: (d) => q(d.title, (t) => `added “${t}” to the club profile`, "added a document to the club profile"), public: false },
  "club.document_removed": { label: "Removed a profile document", phrase: (d) => q(d.title, (t) => `took “${t}” off the club profile`, "took a document off the club profile"), public: false },
  "club.submitted": { label: "Submitted a club to WSUSA", phrase: "submitted the club to WSUSA", public: false },
  "club.resubmitted": { label: "Resubmitted a club to WSUSA", phrase: "resubmitted the club to WSUSA", public: false },
  "club.approved": { label: "Approved a club", phrase: "approved the club", public: true },
  "club.changes_requested": { label: "Asked a club for changes", phrase: "asked the club for changes", public: false },
  "club.rejected": { label: "Didn't approve a club", phrase: "decided not to approve the club", public: false },
  "club.retired": { label: "Retired a club", phrase: "retired the club", public: true },
  "club.reinstated": { label: "Reinstated a club", phrase: "reinstated the club", public: true },
  "club.ambassador_program_started": { label: "Started a college ambassador program", phrase: "started the college's ambassador program", public: true },

  // ─── Constitutions ─────────────────────────────────────────────────────────
  "constitution.draft_created": { label: "Started a constitution draft", phrase: "started a constitution draft", public: false },
  "constitution.draft_saved": { label: "Saved a constitution draft", phrase: "saved the constitution draft", public: false, busy: true },
  "constitution.draft_deleted": { label: "Deleted a constitution draft", phrase: "deleted a constitution draft", public: false },
  "constitution.adopted": { label: "Adopted a constitution and bylaws", phrase: "adopted a new constitution and bylaws", public: true },
  "constitution.custom_submitted": { label: "Sent a custom document to WSUSA", phrase: "sent a custom document to WSUSA", public: false },
  "constitution.custom_withdrawn": { label: "Withdrew a custom document", phrase: "withdrew a custom document", public: false },
  "constitution.custom_approved": { label: "Approved a custom document", phrase: "approved the club's custom document", public: true },
  "constitution.custom_rejected": { label: "Returned a custom document", phrase: "returned the club's custom document", public: false },

  // ─── Directory (admin) ─────────────────────────────────────────────────────
  "college.created": { label: "Added a college", phrase: (d) => q(d.name, (n) => `added ${n} to the directory`, "added a college"), public: false },
  "college.updated": { label: "Edited a college", phrase: (d) => q(d.name, (n) => `edited ${n}`, "edited a college"), public: false },
  "college.deleted": { label: "Deleted a college", phrase: (d) => q(d.name, (n) => `deleted ${n} from the directory`, "deleted a college"), public: false },
  "department.created": { label: "Added a department", phrase: (d) => q(d.name, (n) => `added “${n}” to the department list`, "added a department"), public: false },
  "department.linked": { label: "Linked a club's department", phrase: (d) => q(d.name, (n) => `linked ${n} as the club's department`, "linked the club's department"), public: false },
  "department.updated": { label: "Edited a department", phrase: (d) => q(d.name, (n) => `edited the department “${n}”`, "edited a department"), public: false },
  "department.deleted": { label: "Deleted a department", phrase: (d) => q(d.name, (n) => `deleted the department “${n}”`, "deleted a department"), public: false },
  "major.created": { label: "Added a major", phrase: (d) => q(d.name, (n) => `added the major “${n}”`, "added a major"), public: false },
  "major.updated": { label: "Edited a major", phrase: (d) => q(d.name, (n) => `edited the major “${n}”`, "edited a major"), public: false },
  "major.deleted": { label: "Deleted a major", phrase: (d) => q(d.name, (n) => `deleted the major “${n}”`, "deleted a major"), public: false },
  "building.created": { label: "Added a building", phrase: (d) => q(d.name, (n) => `added the building ${n}`, "added a building"), public: false },
  "building.updated": { label: "Edited a building", phrase: (d) => q(d.name, (n) => `edited the building ${n}`, "edited a building"), public: false },
  "building.deleted": { label: "Deleted a building", phrase: (d) => q(d.name, (n) => `deleted the building ${n}`, "deleted a building"), public: false },

  // ─── Elections (filling seats) ─────────────────────────────────────────────
  "election.created": { label: "Started an election", phrase: (d) => q(d.title, (t) => `started “${t}”`, "started an election"), public: true },
  "election.voting_opened": { label: "Opened voting", phrase: "opened voting in an election", public: false },
  "election.closed": { label: "Closed an election", phrase: "closed an election", public: false },
  "election.nominated": { label: "Nominated a candidate", phrase: (d) => (d.self === true ? "ran in an election" : "added a candidate to an election"), public: false },
  "election.statement_updated": { label: "Updated a candidate statement", phrase: "updated their candidate statement", public: false },
  "election.declined": { label: "Said no to moving up", phrase: "said no to moving up", public: false },
  "election.withdrawn": { label: "Withdrew from an election", phrase: (d) => (d.self === false ? "took a candidate out of an election" : "withdrew from an election"), public: false },
  "election.accepted": { label: "Said yes to moving up", phrase: "said yes to moving up", public: false },
  "election.cancelled": { label: "Cancelled an election", phrase: "cancelled an election", public: true },
  "election.applied": { label: "Applied an election result", phrase: (d) => q(d.title, (t) => `applied the “${t}” result`, "applied an election result"), public: true },
  "election.proposed": { label: "Proposed a candidate", phrase: "proposed a candidate for a seat", public: false },
  "election.proposal_withdrawn": { label: "Withdrew a proposed candidate", phrase: "withdrew a proposed candidate", public: false },
  "election.proposal_declined": { label: "Sent back a proposed candidate", phrase: "sent back a proposed candidate", public: false },
  /** Ballots are secret; even who voted stays out of feeds. */
  "vote.cast": { label: "Voted in an election", phrase: "voted in an election", public: false, busy: true },

  // ─── Events ────────────────────────────────────────────────────────────────
  /** Public when the event is (the call site decides). */
  "event.created": { label: "Created an event", phrase: (d) => q(d.title, (t) => `added “${t}” to the calendar`, "added an event to the calendar"), public: false },
  "event.university_created": { label: "Created a university event", phrase: (d) => q(d.title, (t) => `added “${t}” to the university calendar`, "added a university event"), public: false },
  "event.updated": { label: "Updated an event", phrase: (d) => q(d.title, (t) => `updated “${t}”`, "updated an event"), public: false },
  "event.moved": { label: "Rescheduled an event", phrase: (d) => q(d.title, (t) => `rescheduled “${t}”`, "rescheduled an event"), public: false },
  "event.meet_created": { label: "Added a Google Meet link", phrase: "added a Google Meet link to an event", public: false },
  "event.cancelled": { label: "Cancelled an event", phrase: (d) => q(d.title, (t) => `cancelled “${t}”`, "cancelled an event"), public: false },
  "event.restored": { label: "Restored a cancelled event", phrase: "restored a cancelled event", public: false },
  "event.occurrence_cancelled": { label: "Cancelled one meeting", phrase: "cancelled one meeting of an event", public: false },
  "event.occurrence_restored": { label: "Restored one meeting", phrase: "restored a cancelled meeting", public: false },
  "event.room_changed": { label: "Changed a meeting's room", phrase: (d) => q(d.room, (r) => `moved a meeting to ${r}`, "changed a meeting's room"), public: false },
  "event.deleted": { label: "Deleted an event", phrase: (d) => q(d.title, (t) => `deleted “${t}”`, "deleted an event"), public: false },
  "event.cohost_approved": { label: "Accepted a co-host request", phrase: (d) => q(d.title, (t) => `agreed to co-host “${t}”`, "agreed to co-host an event"), public: true },
  "event.cohost_declined": { label: "Declined a co-host request", phrase: (d) => q(d.title, (t) => `declined to co-host “${t}”`, "declined to co-host an event"), public: false },
  "event.cohost_left": { label: "Stopped co-hosting an event", phrase: (d) => q(d.title, (t) => `stopped co-hosting “${t}”`, "stopped co-hosting an event"), public: false },
  "event.cost_added": { label: "Added an event cost", phrase: "added an event cost", public: false },
  "event.cost_updated": { label: "Edited an event cost", phrase: "edited an event cost", public: false },
  "event.cost_removed": { label: "Removed an event cost", phrase: "removed an event cost", public: false },

  // ─── Files ─────────────────────────────────────────────────────────────────
  "file.default_folders": { label: "Set up starting folders", phrase: "set up the club's starting folders", public: false },
  "file.folder_created": { label: "Made a folder", phrase: (d) => q(d.name, (n) => `made the folder “${n}”`, "made a folder"), public: false },
  "file.uploaded": { label: "Uploaded a file", phrase: (d) => q(d.name, (n) => `uploaded “${n}”`, "uploaded a file"), public: false },
  "file.renamed": { label: "Renamed a file", phrase: "renamed a file", public: false, busy: true },
  "file.moved": { label: "Moved files", phrase: "moved files", public: false, busy: true },
  "file.visibility_set": { label: "Changed who can open a file", phrase: (d) => q(d.name, (n) => `changed who can open “${n}”`, "changed who can open a file"), public: false },
  "file.featured_set": { label: "Updated the club page Resources", phrase: "updated the club page Resources", public: false },
  "file.shared": { label: "Shared a file", phrase: (d) => q(d.name, (n) => `shared “${n}”`, "shared a file"), public: false },
  "file.share_changed": { label: "Changed someone's file access", phrase: "changed someone's file access", public: false },
  "file.unshared": { label: "Removed someone's file access", phrase: "removed someone's file access", public: false },
  "file.trashed": { label: "Moved files to the trash", phrase: "moved files to the trash", public: false },
  "file.restored": { label: "Restored files from the trash", phrase: "restored files from the trash", public: false },
  "file.deleted": { label: "Deleted files for good", phrase: "deleted files for good", public: false },

  // ─── Memberships ───────────────────────────────────────────────────────────
  "membership.requested": { label: "Asked to join a club", phrase: "asked to join", public: false },
  "membership.joined": { label: "Joined a club", phrase: "joined the club", public: true },
  "membership.approved": { label: "Approved a join request", phrase: "approved a join request", public: true },
  "membership.declined": { label: "Declined a join request", phrase: "declined a join request", public: false },
  "membership.left": { label: "Left a club", phrase: "left the club", public: false },
  "membership.removed": { label: "Removed a member", phrase: "removed a member", public: false },
  "membership.title_set": { label: "Set a member's title", phrase: (d) => q(d.title, (t) => `gave a member the title “${t}”`, "cleared a member's title"), public: false },

  // ─── Messages and notifications ────────────────────────────────────────────
  "conversation.created": { label: "Started a conversation", phrase: "started a conversation", public: false },
  "conversation.members_added": { label: "Added people to a conversation", phrase: "added people to a conversation", public: false },
  "conversation.renamed": { label: "Renamed a conversation", phrase: "renamed a conversation", public: false },
  "conversation.left": { label: "Left a conversation", phrase: "left a conversation", public: false },
  "message.sent": { label: "Sent a message", phrase: "sent a message", public: false, busy: true },
  "message.edited": { label: "Edited a message", phrase: "edited a message", public: false, busy: true },
  "message.deleted": { label: "Deleted a message", phrase: "deleted a message", public: false, busy: true },
  "notifications.read_all": { label: "Marked every notification read", phrase: "marked every notification read", public: false, busy: true },

  // ─── Org chart and roles ───────────────────────────────────────────────────
  "orgchart.defaults_started": { label: "Set up the default org chart", phrase: "set up the default org chart", public: false },
  "orgchart.defaults_restored": { label: "Restored the default seats", phrase: "restored the default org chart seats", public: false },
  "orgchart.seat_created": { label: "Added an org chart seat", phrase: (d) => q(d.name, (n) => `added the ${n} seat`, "added a seat to the org chart"), public: false },
  "orgchart.seat_updated": { label: "Edited an org chart seat", phrase: (d) => q(d.name, (n) => `edited the ${n} seat`, "edited a seat on the org chart"), public: false },
  "orgchart.seat_moved": { label: "Reordered the org chart", phrase: "moved a seat on the org chart", public: false },
  "orgchart.seat_archived": { label: "Removed an org chart seat", phrase: (d) => q(d.name, (n) => `removed the ${n} seat`, "removed a seat from the org chart"), public: false },
  "orgchart.seat_restored": { label: "Restored an org chart seat", phrase: (d) => q(d.name, (n) => `restored the ${n} seat`, "restored a seat on the org chart"), public: false },
  "role.assigned": {
    label: "Assigned a role",
    phrase: (d, w) => q(text(d.position) ?? w.role(d.role), (seat) => `filled the ${seat} seat`, "assigned a role"),
    public: true,
  },
  "role.ended": { label: "Ended a role", phrase: (d, w) => q(w.role(d.role), (role) => `ended ${an(role)} role`, "ended a role"), public: true },
  "role.handoff": { label: "Handed off the presidency", phrase: "handed off the presidency", public: true },
  "role.permissions_set": { label: "Changed a leader's permissions", phrase: "changed a leader's permissions", public: false, busy: true },

  // ─── Policies ──────────────────────────────────────────────────────────────
  "policy.created": { label: "Started a policy", phrase: (d) => q(d.title, (t) => `started the policy “${t}”`, "started a policy"), public: false },
  "policy.saved": { label: "Saved a policy", phrase: (d) => q(d.title, (t) => `saved the policy “${t}”`, "saved a policy"), public: false },
  "policy.published": { label: "Published a policy", phrase: (d) => q(d.title, (t) => `published the policy “${t}”`, "published a policy"), public: true },
  "policy.updated": { label: "Updated a published policy", phrase: (d) => q(d.title, (t) => `updated the policy “${t}”`, "updated a policy"), public: false },
  "policy.archived": { label: "Archived a policy", phrase: (d) => q(d.title, (t) => `archived the policy “${t}”`, "archived a policy"), public: false },
  "policy.deleted": { label: "Deleted a policy", phrase: (d) => q(d.title, (t) => `deleted the policy “${t}”`, "deleted a policy"), public: false },

  // ─── Profiles, projects and accounts ───────────────────────────────────────
  "profile.updated": { label: "Updated their profile", phrase: "updated their profile", public: false },
  "profile.experience_added": { label: "Added experience to their profile", phrase: "added experience to their profile", public: false },
  "profile.experience_updated": { label: "Edited experience on their profile", phrase: "edited experience on their profile", public: false },
  "profile.experience_removed": { label: "Removed experience from their profile", phrase: "removed experience from their profile", public: false },
  "profile.linkedin_imported": { label: "Imported positions from LinkedIn", phrase: "imported positions from LinkedIn", public: false },
  "profile.education_added": { label: "Added education to their profile", phrase: "added education to their profile", public: false },
  "profile.education_updated": { label: "Edited education on their profile", phrase: "edited education on their profile", public: false },
  "profile.education_removed": { label: "Removed education from their profile", phrase: "removed education from their profile", public: false },
  "project.added": { label: "Added a project", phrase: (d) => q(d.title, (t) => `added the project “${t}”`, "added a project"), public: true },
  "project.updated": { label: "Edited a project", phrase: (d) => q(d.title, (t) => `edited the project “${t}”`, "edited a project"), public: false },
  "project.removed": { label: "Removed a project", phrase: (d) => q(d.title, (t) => `removed the project “${t}”`, "removed a project"), public: false },
  "project.unlinked": { label: "Unlinked a project from a role", phrase: "unlinked a project from a role", public: false },
  "details.updated": { label: "Updated their member details", phrase: "updated their member details", public: false },
  "details.confirmed": { label: "Confirmed their member details", phrase: "confirmed their member details", public: false },
  "details.emergency_viewed": { label: "Opened a member's emergency contact", phrase: "opened a member's emergency contact", public: false },
  "device.push_added": { label: "Turned on push notifications on a device", phrase: "turned on push notifications on a device", public: false },
  "device.push_moved": { label: "Moved a device's push notifications to their account", phrase: "moved a device's push notifications to their account", public: false },
  "device.push_removed": { label: "Turned off push notifications on a device", phrase: "turned off push notifications on a device", public: false },
  "user.created": { label: "Created their account", phrase: "joined Wildcat Clubs", public: false },
  "user.settings_updated": { label: "Changed their settings", phrase: "changed their settings", public: false },
  "user.app_prompt_dismissed": { label: "Dismissed the get-the-app prompt", phrase: "dismissed the get-the-app prompt", public: false },
  "user.graduated": { label: "Recorded a graduation", phrase: "recorded a graduation", public: true },
  "user.alumni_undone": { label: "Undid a graduation", phrase: "undid a graduation", public: false },
  "user.deactivated": { label: "Deactivated an account", phrase: "deactivated an account", public: false },
  "user.reactivated": { label: "Reactivated an account", phrase: "reactivated an account", public: false },

  // ─── Reports of concerns (never in feeds or the assistant) ─────────────────
  "complaint.submitted": { label: "Reported a concern", phrase: "reported a concern", public: false },
  "complaint.note_added": { label: "Added a note to a report", phrase: "added a note to a report", public: false },
  "complaint.status_changed": { label: "Updated a report's status", phrase: "updated a report's status", public: false },

  // ─── Requirements, tests and forms ─────────────────────────────────────────
  "requirement.created": { label: "Added a WSUSA requirement", phrase: (d) => q(d.name, (n) => `added the requirement “${n}”`, "added a WSUSA requirement"), public: false },
  "requirement.updated": { label: "Edited a WSUSA requirement", phrase: (d) => q(d.name, (n) => `edited the requirement “${n}”`, "edited a WSUSA requirement"), public: false },
  "requirement.activated": { label: "Turned on a WSUSA requirement", phrase: (d) => q(d.name, (n) => `turned on the requirement “${n}”`, "turned on a WSUSA requirement"), public: false },
  "requirement.deactivated": { label: "Turned off a WSUSA requirement", phrase: (d) => q(d.name, (n) => `turned off the requirement “${n}”`, "turned off a WSUSA requirement"), public: false },
  "test.created": { label: "Created a test", phrase: (d) => q(d.title, (t) => `created the ${d.isForm === true ? "form" : "test"} “${t}”`, "created a test"), public: false },
  "test.updated": { label: "Edited a test", phrase: (d) => (d.isForm === true ? "edited a form" : "edited a test"), public: false },
  "test.selection_set": { label: "Chose who takes a test", phrase: "chose who takes a test", public: false },
  "test.published": { label: "Published a test", phrase: (d) => q(d.title, (t) => `published “${t}”`, "published a test"), public: false },
  "test.reopened": { label: "Reopened a test", phrase: (d) => q(d.title, (t) => `reopened “${t}”`, "reopened a test"), public: false },
  "test.archived": { label: "Archived a test", phrase: (d) => q(d.title, (t) => `archived “${t}”`, "archived a test"), public: false },
  "test.duplicated": { label: "Copied a test", phrase: (d) => q(d.title, (t) => `copied a test as “${t}”`, "copied a test"), public: false },
  "test.deleted": { label: "Deleted a test", phrase: (d) => q(d.title, (t) => `deleted “${t}”`, "deleted a test"), public: false },
  "test.assigned": { label: "Assigned a test", phrase: (d) => (typeof d.people === "number" ? `assigned a test to ${d.people} ${d.people === 1 ? "person" : "people"}` : "assigned a test"), public: false },
  "test.attempt_started": { label: "Started a test", phrase: "started a test", public: false },
  "test.attempt_submitted": { label: "Turned in a test", phrase: (d) => (d.isForm === true ? "turned in a form" : "turned in a test"), public: false },
  "test.attempt_graded": { label: "Graded a test", phrase: "graded a test", public: false },
  "test.ai_suggested": { label: "Asked Claude for grading feedback", phrase: "asked Claude to suggest feedback on an answer", public: false },
  "test.passed": { label: "Passed a test", phrase: "passed a test", public: false },
  "test.form_submitted": { label: "Filled out a form", phrase: "filled out a form", public: false },
  "test.permissions_paused": { label: "Paused a leader's permissions", phrase: "paused a leader's permissions after a test result", public: false },
  "test.permissions_resumed": { label: "Gave a leader's permissions back", phrase: "gave a leader's permissions back after a test result", public: false },
  "test.assignment_missed": { label: "Recorded a missed test deadline", phrase: "recorded a missed test deadline", public: false },

  // ─── Reviews ───────────────────────────────────────────────────────────────
  "review.created": { label: "Wrote a review", phrase: "reviewed the club", public: true },
  "review.updated": { label: "Edited a review", phrase: "edited their review of the club", public: true },
  "review.deleted": { label: "Deleted a review", phrase: "deleted their review of the club", public: false },
  "review.flagged": { label: "Flagged a review", phrase: "flagged a review", public: false },
  "review.hidden": { label: "Hid a review", phrase: "hid a review", public: false },
  "review.restored": { label: "Restored a review", phrase: "restored a hidden review", public: false },
  "review.reports_cleared": { label: "Kept a flagged review", phrase: "kept a flagged review up", public: false },
  "review.bombing_flagged": { label: "Flagged possible review bombing", phrase: "flagged possible review bombing", public: false },
  "review.bombing_reviewed": { label: "Closed a review-bombing check", phrase: "closed a review-bombing check", public: false },

  // ─── System (sysadmins) ────────────────────────────────────────────────────
  "system.config_changed": { label: "Changed system settings", phrase: "changed system settings", public: false },
  "system.config_confirmed": { label: "Confirmed system settings", phrase: "confirmed system settings", public: false },
  "system.jobs_run": { label: "Ran the scheduled jobs", phrase: "ran the scheduled jobs", public: false },
  "system.admin_granted": { label: "Made someone an administrator", phrase: "made someone an administrator", public: false },
  "system.admin_revoked": { label: "Removed an administrator", phrase: "removed an administrator", public: false },
  "system.sysadmin_granted": { label: "Made someone a system administrator", phrase: "made someone a system administrator", public: false },
  "system.sysadmin_revoked": { label: "Removed a system administrator", phrase: "removed a system administrator", public: false },
  "term.created": { label: "Added a term", phrase: "added a term to the academic calendar", public: false },
  "term.updated": { label: "Edited a term", phrase: "edited a term on the academic calendar", public: false },
  "term.deleted": { label: "Deleted a term", phrase: "deleted a term from the academic calendar", public: false },

  // ─── Tasks ─────────────────────────────────────────────────────────────────
  "task.created": { label: "Added a to-do", phrase: "added a to-do", public: false },
  "task.updated": { label: "Edited a to-do", phrase: "edited a to-do", public: false },
  "task.completed": { label: "Finished a task", phrase: "finished a task", public: false, busy: true },
  "task.reopened": { label: "Reopened a task", phrase: "reopened a task", public: false, busy: true },
  "task.deleted": { label: "Deleted a to-do", phrase: "deleted a to-do", public: false },
  "task.assigned": { label: "Assigned a club to-do", phrase: (d) => q(d.title, (t) => `assigned the club to-do “${t}”`, "assigned a club to-do"), public: false },
  "task.cancelled": { label: "Cancelled a club to-do", phrase: (d) => q(d.title, (t) => `cancelled the club to-do “${t}”`, "cancelled a club to-do"), public: false },
} as const satisfies Record<string, ActionEntry>;

export type ActionName = keyof typeof ACTIONS;

/** Actions whose rows are public by default: the only ones a public feed (profiles) may ask for. */
export type PublicAction = { [K in ActionName]: (typeof ACTIONS)[K]["public"] extends true ? K : never }[ActionName];

const ENTRIES: Readonly<Record<string, ActionEntry | undefined>> = ACTIONS;

export function isAction(action: string): action is ActionName {
  return Object.hasOwn(ACTIONS, action);
}

/** Whether a row with this action is public when the call site doesn't say. Unknown actions stay private. */
export function isPublicByDefault(action: string): boolean {
  return ENTRIES[action]?.public ?? false;
}

/** Busy actions, for feeds' `action: { notIn: … }`. */
export const BUSY_ACTIONS = (Object.keys(ACTIONS) as ActionName[]).filter((a) => (ACTIONS[a] as ActionEntry).busy);

/** "Assigned a role". An action written before this catalog falls back to readable words ("Constitution: draft saved"). */
export function actionLabel(action: string): string {
  const e = ENTRIES[action];
  if (e) return e.label;
  const [area, verb] = action.split(".");
  const words = (s: string | undefined) => (s ?? "").replace(/_/g, " ").trim();
  const t = verb ? `${words(area)}: ${words(verb)}` : words(area);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * "filled the Treasurer seat", for after the actor's name. Pass lib/authz
 * ROLE_LABEL as `roleLabels` so role actions can name the role.
 */
export function actionPhrase(action: string, data?: unknown, roleLabels: Readonly<Record<string, string>> = {}): string {
  const e = ENTRIES[action];
  if (!e) return "made a change";
  if (typeof e.phrase === "string") return e.phrase;
  const d: Data = data && typeof data === "object" && !Array.isArray(data) ? (data as Data) : {};
  return e.phrase(d, { role: (r) => (typeof r === "string" && Object.hasOwn(roleLabels, r) ? roleLabels[r] : null) });
}
