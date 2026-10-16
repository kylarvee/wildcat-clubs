import type { ClubRole, ClubType } from "@prisma/client";
import type { Capability } from "@/lib/authz";

/**
 * The native org structure every club starts with. Clubs can rename seats,
 * edit responsibilities, add officer seats and change default permissions in
 * the Org Chart tool; President and VP seats are core and can't be removed.
 */
export type SeatTemplate = {
  role: ClubRole;
  name: string;
  responsibilities: string[];
  defaultPermissions: Capability[];
  maxHolders: number;
  isCore?: boolean;
};

export const CLUB_SEATS: SeatTemplate[] = [
  {
    role: "PRESIDENT",
    name: "President",
    isCore: true,
    maxHolders: 2, // co-presidents allowed
    defaultPermissions: [],
    responsibilities: [
      "Leads the club and chairs its meetings",
      "Primary contact for the advisor and WSUSA",
      "Keeps the club in line with university policy, trainings and funding rules",
      "Sets the org structure and names their successor per the bylaws",
      "Approves major plans, budgets and co-hosted events",
    ],
  },
  {
    role: "VP",
    name: "Vice President",
    isCore: true,
    maxHolders: 2,
    defaultPermissions: [],
    responsibilities: [
      "Runs the club when the president is unavailable",
      "Coordinates the officers and keeps projects on schedule",
      "Onboards new officers and sets up their permissions",
      "Leads planning for the next term",
    ],
  },
  {
    role: "OFFICER",
    name: "Secretary",
    maxHolders: 1,
    defaultPermissions: ["attendance", "files", "announcements"],
    responsibilities: ["Runs check-in and keeps attendance accurate", "Takes and shares meeting minutes", "Keeps club files organized"],
  },
  {
    role: "OFFICER",
    name: "Treasurer",
    maxHolders: 1,
    defaultPermissions: ["budget"],
    responsibilities: ["Builds the term budget", "Submits funding requests and tracks spending", "Keeps receipts and reports to the advisor"],
  },
  {
    role: "OFFICER",
    name: "Events Coordinator",
    maxHolders: 2,
    defaultPermissions: ["events", "attendance"],
    responsibilities: ["Plans events in the Events Builder", "Books rooms and handles logistics", "Coordinates co-hosted events with other clubs"],
  },
  {
    role: "OFFICER",
    name: "Communications Officer",
    maxHolders: 1,
    defaultPermissions: ["announcements", "profile"],
    responsibilities: ["Posts announcements and keeps the club page current", "Runs social media and flyers", "Works with the college ambassador on marketing"],
  },
  {
    role: "OFFICER",
    name: "Membership Officer",
    maxHolders: 1,
    defaultPermissions: ["roster", "attendance"],
    responsibilities: ["Recruits and welcomes new members", "Approves join requests", "Watches retention and follows up with members who drift"],
  },
  {
    role: "AMBASSADOR",
    name: "College Ambassador",
    maxHolders: 2,
    defaultPermissions: [],
    responsibilities: ["Relays news and needs between the club and the college", "Connects the club with college marketing and events"],
  },
];

/** The College Ambassadors org (one per college, created by admins). */
export const AMBASSADOR_ORG_SEATS: SeatTemplate[] = [
  { ...CLUB_SEATS[0], responsibilities: ["Leads the college's ambassador program", "Meets with college leadership", "Places club-representative ambassadors in clubs"] },
  { ...CLUB_SEATS[1], responsibilities: ["Runs the program when the president is unavailable", "Coordinates the ambassador teams"] },
  { role: "AMBASSADOR", name: "Marketing Ambassador", maxHolders: 4, defaultPermissions: ["announcements", "profile"], responsibilities: ["Markets college clubs and events", "Gives clubs one place to get marketing help"] },
  { role: "AMBASSADOR", name: "Inter-club Coordination Ambassador", maxHolders: 4, defaultPermissions: ["events"], responsibilities: ["Connects clubs for co-hosted events", "Keeps the college's clubs from double-booking"] },
  { role: "AMBASSADOR", name: "Events Ambassador", maxHolders: 4, defaultPermissions: ["events", "attendance"], responsibilities: ["Plans larger, college-wide events"] },
  { role: "AMBASSADOR", name: "Club Representative Ambassador", maxHolders: 50, defaultPermissions: [], responsibilities: ["Embedded in a club as its College Ambassador", "Carries the club's concerns to the college and the college's news to the club"] },
];

export function seatsFor(type: ClubType): SeatTemplate[] {
  return type === "COLLEGE_AMBASSADORS" ? AMBASSADOR_ORG_SEATS : CLUB_SEATS;
}
