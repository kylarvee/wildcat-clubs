/**
 * Test personas — one signed-in view of every role in the spec. The seed
 * creates exactly these accounts (and their clubs, roles and history); the
 * sign-in page lists them when AUTH_MODE allows personas. Single source: if a
 * persona changes, change it here and re-seed.
 */
export type Persona = {
  key: string;
  name: string;
  email: string;
  group: "Students" | "Faculty & staff" | "Administration";
  label: string;
  blurb: string;
};

export const PERSONAS: Persona[] = [
  { key: "sam", name: "Sam Rivera", email: "sam.rivera@mail.weber.edu", group: "Students", label: "New student", blurb: "Just signed in. No clubs yet — try registering for one." },
  { key: "maya", name: "Maya Chen", email: "maya.chen@mail.weber.edu", group: "Students", label: "Club member", blurb: "Member of four clubs, attends often, can leave reviews." },
  { key: "oscar", name: "Oscar Nguyen", email: "oscar.nguyen@mail.weber.edu", group: "Students", label: "Officer (Treasurer)", blurb: "Treasurer with budget permissions and an officer test due." },
  { key: "vanessa", name: "Vanessa Brooks", email: "vanessa.brooks@mail.weber.edu", group: "Students", label: "Vice President", blurb: "Runs events and officers; can't name the next president." },
  { key: "priya", name: "Priya Patel", email: "priya.patel@mail.weber.edu", group: "Students", label: "President", blurb: "Leads a large club: everything, including succession and retiring." },
  { key: "amir", name: "Amir Haddad", email: "amir.haddad@mail.weber.edu", group: "Students", label: "College ambassador", blurb: "Goddard School ambassador embedded in business clubs." },
  { key: "frank", name: "Frank Okafor", email: "frank.okafor@mail.weber.edu", group: "Students", label: "Club founder", blurb: "Building a new club (draft) and waiting on another's review." },
  { key: "gwen", name: "Gwen Torres", email: "gwen.torres@mail.weber.edu", group: "Students", label: "Alumni", blurb: "Graduated former president — profile retired, history kept." },
  { key: "elena", name: "Dr. Elena Alvarez", email: "elena.alvarez@weber.edu", group: "Faculty & staff", label: "Club advisor", blurb: "Advises two clubs with full permissions in both." },
  { key: "nathan", name: "Prof. Nathan Reed", email: "nathan.reed@weber.edu", group: "Faculty & staff", label: "Invited advisor", blurb: "Has a pending request to advise a new club." },
  { key: "alex", name: "Alex Morgan", email: "alex.morgan@weber.edu", group: "Administration", label: "Administrator (WSUSA)", blurb: "Reviews clubs, funding, policy, tests and reports." },
  { key: "sydney", name: "Sydney Park", email: "sydney.park@weber.edu", group: "Administration", label: "System administrator", blurb: "Everything, plus system settings, AI switches and admins." },
];
