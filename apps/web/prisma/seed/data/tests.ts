import type { QuestionType } from "@prisma/client";

/** Test content: the officer policy test, a club safety quiz and a funding refresher. */

export type QuestionDef = {
  type: QuestionType;
  prompt: string;
  options?: { id: string; text: string }[];
  correct?: string[];
  modelAnswer?: string;
  /** Sample open answers: [good, weak]. */
  answers?: [string, string];
};

export const OFFICER_TEST_INTRO = `<h2>Before you start</h2><p>This test covers the WSUSA policies every club officer, vice president and president needs to know: review integrity, hazing, non-discrimination, event safety, funding and anonymous reporting. Passing it once each academic year keeps your officer permissions on Wildcat Clubs active.</p><div data-embed="video" data-src="https://www.youtube.com/watch?v=aqz-KE-bpKQ" data-title="Officer orientation (sample video — replace with WSUSA's orientation video)"></div><h3>How it works</h3><ul><li>You have <strong>30 minutes</strong> once you press Start. The timer keeps running if you leave the page.</li><li>You need <strong>80%</strong> to pass. You can retake it if you don't pass.</li><li>Multiple-choice answers are scored right away. Short and long answers are read by a WSUSA reviewer, so your final result may take a couple of days.</li></ul><h3>Read these first</h3><ul><li>Hazing Prohibition</li><li>Funding &amp; Purchasing</li><li>Event Safety</li><li>Review Integrity</li></ul>`;

export const OFFICER_QUESTIONS: QuestionDef[] = [
  {
    type: "SINGLE_CHOICE",
    prompt: "<p>What counts as <strong>review bombing</strong> on Wildcat Clubs?</p>",
    options: [
      { id: "a", text: "Organizing people to post negative reviews of a club with malicious intent" },
      { id: "b", text: "Leaving an honest two-star review after a bad experience" },
      { id: "c", text: "Editing your own review after a club improves" },
      { id: "d", text: "Reporting a review you think breaks policy" },
    ],
    correct: ["a"],
  },
  {
    type: "SINGLE_CHOICE",
    prompt: "<p>How many of a club's events must a student attend before they can review it?</p>",
    options: [
      { id: "a", text: "One" },
      { id: "b", text: "Three" },
      { id: "c", text: "Five" },
      { id: "d", text: "Any registered member can review right away" },
    ],
    correct: ["b"],
  },
  {
    type: "MULTI_CHOICE",
    prompt: "<p>Which of these are <strong>hazing</strong> under university policy? Select all that apply.</p>",
    options: [
      { id: "a", text: "Requiring new members to drink to be accepted" },
      { id: "b", text: "Making new members do embarrassing stunts to earn a spot on a trip" },
      { id: "c", text: "Asking new members to attend a 30-minute orientation" },
      { id: "d", text: "Keeping new members up all night as part of an initiation" },
    ],
    correct: ["a", "b", "d"],
  },
  {
    type: "SINGLE_CHOICE",
    prompt: "<p>Your club wants WSUSA to pay for pizza at next month's meeting. When do you submit the funding request?</p>",
    options: [
      { id: "a", text: "After the meeting, with the receipt" },
      { id: "b", text: "Before buying anything, from the Budget tool" },
      { id: "c", text: "Any time — WSUSA reimburses all club purchases" },
      { id: "d", text: "Never — food can't be funded" },
    ],
    correct: ["b"],
  },
  {
    type: "SINGLE_CHOICE",
    prompt: "<p>Who can see an <strong>anonymous</strong> report about your club?</p>",
    options: [
      { id: "a", text: "Your club's advisor" },
      { id: "b", text: "Only the university administrators who handle reports" },
      { id: "c", text: "The club president" },
      { id: "d", text: "Anyone who has the case code" },
    ],
    correct: ["b"],
  },
  {
    type: "MULTI_CHOICE",
    prompt: "<p>Before an off-campus hike with 25 members, which of these do you need to do? Select all that apply.</p>",
    options: [
      { id: "a", text: "List the event with its real location in the Events Builder" },
      { id: "b", text: "Tell your advisor and share the plan" },
      { id: "c", text: "Collect members' Social Security numbers" },
      { id: "d", text: "Make sure waivers are on file and someone knows the emergency plan" },
    ],
    correct: ["a", "b", "d"],
  },
  {
    type: "SINGLE_CHOICE",
    prompt: "<p>A student is turned away from joining a club because of their religion. Which policy does this break?</p>",
    options: [
      { id: "a", text: "None — clubs choose their own members" },
      { id: "b", text: "Non-Discrimination in Clubs" },
      { id: "c", text: "Funding & Purchasing" },
      { id: "d", text: "Files & Messaging Acceptable Use" },
    ],
    correct: ["b"],
  },
  {
    type: "SINGLE_CHOICE",
    prompt: "<p>Your 30-day deadline passes before you pass this test. What happens?</p>",
    options: [
      { id: "a", text: "You lose your officer title" },
      { id: "b", text: "Your officer permissions pause until you pass, then come back" },
      { id: "c", text: "Your whole club is suspended" },
      { id: "d", text: "Nothing" },
    ],
    correct: ["b"],
  },
  {
    type: "SHORT_ANSWER",
    prompt: "<p>In one or two sentences: a member tells you they were hazed at a club event. What do you do?</p>",
    modelAnswer: "Make sure they're safe and believed, don't investigate or confront anyone yourself, and report it to WSUSA or the Dean of Students right away — through Report a concern, anonymously if the member prefers.",
    answers: [
      "<p>Check that they're okay, then report it to WSUSA through Report a concern (they can stay anonymous). I wouldn't confront the people involved myself.</p>",
      "<p>Talk to the people who did it and tell them to stop.</p>",
    ],
  },
  {
    type: "LONG_ANSWER",
    prompt: "<p>Describe how you'd plan a safe off-campus service day for about 30 members, from planning through the day itself.</p>",
    modelAnswer:
      "Strong answers cover: creating the event in the Events Builder with the real address; requesting any funding before buying supplies; telling the advisor and sharing the plan; transportation with approved drivers or carpools; waivers if the activity needs them; an emergency plan (who calls for help, nearest hospital, first aid kit); QR check-in so there's an accurate headcount; and a follow-up afterward.",
    answers: [
      "<p>I'd put the event in the Events Builder with the address of the site and request funding for gloves and water two weeks ahead. Our advisor would get the plan and the list of drivers, and we'd use Campus Rec–approved drivers. On the day we'd check everyone in with the QR code, do a quick safety talk, keep a first aid kit and have one officer responsible for calling for help. Afterward we'd post photos and thank the partner.</p>",
      "<p>Pick a date, tell people in the group chat, and meet there. Bring snacks.</p>",
    ],
  },
];

export const SAFETY_QUIZ_INTRO = `<p>Before you use the Noorda makerspace with Wildcat Robotics, take this short quiz on shop safety. It takes about five minutes and you need 80% to pass.</p><div data-embed="video" data-src="https://www.youtube.com/watch?v=aqz-KE-bpKQ" data-title="Makerspace safety walkthrough (sample video)"></div>`;

export const SAFETY_QUESTIONS: QuestionDef[] = [
  {
    type: "SINGLE_CHOICE",
    prompt: "<p>When are safety glasses required in the makerspace?</p>",
    options: [{ id: "a", text: "Only when using the lathe" }, { id: "b", text: "Whenever any tool is running in the room" }, { id: "c", text: "Only when soldering" }],
    correct: ["b"],
  },
  {
    type: "SINGLE_CHOICE",
    prompt: "<p>A LiPo battery is puffy. What do you do?</p>",
    options: [{ id: "a", text: "Keep using it until it dies" }, { id: "b", text: "Stop using it and put it in the fire-safe battery bin, then tell an officer" }, { id: "c", text: "Poke it to release the gas" }],
    correct: ["b"],
  },
  {
    type: "MULTI_CHOICE",
    prompt: "<p>Which are required before running the CNC router? Select all that apply.</p>",
    options: [{ id: "a", text: "Completed CNC training" }, { id: "b", text: "A second person in the room" }, { id: "c", text: "Hair tied back and no loose sleeves" }, { id: "d", text: "Music at full volume" }],
    correct: ["a", "b", "c"],
  },
  {
    type: "SINGLE_CHOICE",
    prompt: "<p>Where is the makerspace's fire extinguisher?</p>",
    options: [{ id: "a", text: "By the north door, next to the first aid kit" }, { id: "b", text: "There isn't one" }, { id: "c", text: "In the officer's car" }],
    correct: ["a"],
  },
  {
    type: "SINGLE_CHOICE",
    prompt: "<p>Someone gets a minor cut. After first aid, what else do you do?</p>",
    options: [{ id: "a", text: "Nothing" }, { id: "b", text: "Tell the officer on duty so it's logged" }, { id: "c", text: "Post it in the group chat" }],
    correct: ["b"],
  },
];

export const FUNDING_QUESTIONS: QuestionDef[] = [
  {
    type: "SINGLE_CHOICE",
    prompt: "<p>What's the default funding source for a Registered club?</p>",
    options: [{ id: "a", text: "WSUSA" }, { id: "b", text: "The college" }, { id: "c", text: "The club president" }],
    correct: ["a"],
  },
  {
    type: "SINGLE_CHOICE",
    prompt: "<p>Where do you enter the cost of food for a specific event?</p>",
    options: [{ id: "a", text: "In the Events Builder, on the event" }, { id: "b", text: "In a club chat message" }, { id: "c", text: "On a paper form" }],
    correct: ["a"],
  },
  {
    type: "MULTI_CHOICE",
    prompt: "<p>Which purchases are not eligible for WSUSA funding? Select all that apply.</p>",
    options: [{ id: "a", text: "Alcohol" }, { id: "b", text: "Gift cards for officers" }, { id: "c", text: "Printing flyers for an event" }, { id: "d", text: "Convention tickets for personal entertainment" }],
    correct: ["a", "b", "d"],
  },
  {
    type: "SINGLE_CHOICE",
    prompt: "<p>Your request was approved. What happens next?</p>",
    options: [{ id: "a", text: "WSUSA creates an invoice and processes payment" }, { id: "b", text: "The treasurer pays and hopes for the best" }, { id: "c", text: "Nothing — approval is the payment" }],
    correct: ["a"],
  },
  {
    type: "SINGLE_CHOICE",
    prompt: "<p>How long do you have to submit receipts after a purchase?</p>",
    options: [{ id: "a", text: "7 days" }, { id: "b", text: "30 days" }, { id: "c", text: "Until the end of the academic year" }],
    correct: ["b"],
  },
];

export const REVIEWER_COMMENTS = [
  "Good — that's exactly the right first step.",
  "Covers the key points. Remember to loop in your advisor.",
  "Please re-read the Hazing Prohibition policy; confronting people yourself can make things worse.",
  "Thorough plan. Nice work on the emergency plan.",
  "Missing the funding and advisor steps.",
];

/** A WSUSA form (nothing graded): every club member confirms it once a year. */
export const CONDUCT_FORM_INTRO = `<p>WSUSA asks every club member to read and confirm this once each academic year. It takes about a minute.</p><ul><li><strong>No hazing.</strong> Not as a "tradition," not as a joke, and not even if someone agrees to it. See the Hazing Prohibition policy.</li><li><strong>Respect everyone.</strong> Clubs are open to every eligible Weber State student, and members and guests are treated with respect.</li><li><strong>Speak up.</strong> Report harassment, discrimination or safety problems through <em>Report a concern</em>. You can stay anonymous.</li></ul>`;

export const CONDUCT_QUESTIONS: QuestionDef[] = [
  { type: "SINGLE_CHOICE", prompt: "<p>I've read WSUSA's Hazing Prohibition. I won't take part in hazing in any club, for any reason.</p>", options: [{ id: "agree", text: "I agree" }] },
  { type: "SINGLE_CHOICE", prompt: "<p>I'll treat every member and guest with respect, and I'll report harassment or discrimination when I see it.</p>", options: [{ id: "agree", text: "I agree" }] },
  { type: "SHORT_ANSWER", prompt: "<p>Type your full name to sign.</p>" },
];
