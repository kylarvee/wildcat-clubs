# Wildcat Clubs — mobile app

The phone version of Wildcat Clubs for Weber State students, faculty and staff.
It keeps to what people need on the go:

- **Scan to check in** — even before signing in. The scan is kept while you sign
  in (or create your account), then the check-in finishes on its own.
- **"Check in?" pop-up** — open a club you belong to while its event is on and
  the app offers to check you in (**Not now** just closes it).
- **Clubs** — search every approved club, Register / Request to join, and
  follow a club's calendar without joining.
- **Calendar** — your subscribed clubs (plus university events if you follow
  them), grouped by day.
- **Notifications** — your notifications, and push notifications on the phone
  (join approvals, announcements, event changes, reminders before events).
- **Me** — attendance in every club, your roles, settings and sign-out.

Everything else (leader tools, budgets, tests, messages, reviews) opens the web
app. Built with Expo SDK 58 and expo-router; it talks only to the web app's
mobile API (`apps/web/src/app/api/m`), which calls the same domain functions as
the web — the app never has its own rules.

## Run it

You need the web app running first (from `apps/web`: `npm run dev -- --port 3100`,
with a seeded database — see `apps/web/prisma/seed/PERSONAS.md`).

```bash
cd apps/mobile
npm install            # first time only
npx expo start         # then press i (iOS simulator), a (Android) or w (web)
```

### On your own phone with Expo Go

1. Install **Expo Go** from the App Store or Google Play.
2. Put the phone on the **same Wi-Fi** as your computer.
3. Find your computer's LAN IP (macOS: `ipconfig getifaddr en0`; Windows:
   `ipconfig`). "localhost" on a phone means the phone itself, so the app needs
   the computer's address:

   ```bash
   EXPO_PUBLIC_API_URL=http://192.168.1.23:3100 npx expo start
   ```

   (or put `EXPO_PUBLIC_API_URL=…` in `apps/mobile/.env.local`, which git ignores).
4. Scan the QR code Expo prints with the phone's camera (iOS) or Expo Go
   (Android).

If the app says it can't reach Wildcat Clubs, check that the web server is
running, the IP is right, and your firewall allows port 3100.

### In a browser

```bash
npx expo start --web   # opens http://localhost:8081, API at http://localhost:3100
```

The web preview is handy for quick checks. The camera scanner works in Chrome
(other browsers: type the code instead), and push notifications are phone-only.

## Signing in

- **Test personas** — while the server's `AUTH_MODE` is `mock` or `both` (the
  default outside production) the sign-in screen lists the seeded personas
  (Maya the club member, Priya the president, Sam the new student…). One tap
  signs you in.
- **Weber State Google** — "Continue with Weber State Google" appears when the
  server can verify Google tokens (`GOOGLE_CLIENT_ID` and/or
  `GOOGLE_IOS_CLIENT_ID` / `GOOGLE_ANDROID_CLIENT_ID` set in `apps/web`) **and**
  this build has the client id for its platform:

  ```bash
  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=…apps.googleusercontent.com
  EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=…apps.googleusercontent.com
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=…apps.googleusercontent.com   # the web preview
  ```

  The app gets an ID token from Google and the server checks it's a verified
  `@mail.weber.edu` / `@weber.edu` account; the first sign-in creates the
  account. Google sign-in needs a development or store build (Google won't
  redirect back into Expo Go). expo-auth-session's Google helper is deprecated
  upstream; when the app moves to EAS builds, `@react-native-google-signin/google-signin`
  is the drop-in replacement for `GoogleSignInButton` — the server side stays
  the same.

The session token is kept in the phone's keychain / keystore (expo-secure-store;
the web preview uses localStorage). Sessions last 180 days; signing out ends the
session on the server and stops pushes to the phone (when signing out offline,
the app tells the server as soon as it's back online).

## Try scanning with the seed data

The seed creates check-in codes relative to when it ran (re-seed right before a
session, `npm run db:seed` in `apps/web`; the seed prints the codes):

| Code | Event | Good for |
|---|---|---|
| `HERE26` | Service & Volunteer Club — Care Kit Assembly (live when seeded, self check-in on) | A new student checking in (Sam): open club → becomes a member |
| `BUILD8` | Wildcat Robotics — Open Build Night (live, members only) | Approval-gated club → join request sent |
| `LATER7` | Psychology Club — Grad School Q&A (about 3 hours after seeding) | Maya's "check in?" pop-up and Home banner once it opens |

- **Real QR:** sign in on the web as a leader of the hosting club (Priya for
  Wildcat Robotics) and open the live check-in screen from the Attendance tool
  (`/checkin/live/<occurrenceId>`), then scan it with the **Scan** tab. The QR
  changes every 30 seconds; the app trades a fresh scan for a 10-minute pass, so
  you can sign in after scanning.
- **No camera:** Scan → **Enter code**, type the code.
- **Deep link:** `wildcatclubs://c/HERE26` opens the check-in screen (it waits
  for you to tap **Check in** — a link alone never checks anyone in).

Check-in windows come from System settings (by default from 30 minutes before
an event until 30 minutes after it ends).

## Push notifications

The app asks for notification permission right after you sign in and registers
the phone's Expo push token with the server (`POST /api/m/push-token`). The
server sends through Expo's push service once a sysadmin switches **Push** on;
until then pushes land in the outbox (`/system/outbox`) so you can see what
would have been sent. Pushed: join approvals, announcements, event changes and
cancellations, reminders about an hour before events (each person's **Remind me
before events** switch in Settings → Notifications), and WSUSA requirements due
in a week or a day. Tapping a notification opens the matching screen (club,
event, calendar, notifications, check-in) or the web page for anything the app
doesn't do.

### One-time setup

Push needs all three of these. Until then the web's Settings → Notifications
says what's missing, and the app's Me → Settings says why the phone can't
register; the Notifications tab works either way.

1. **Create the Expo (EAS) project.** Whoever holds the university's Expo
   account runs, once:

   ```bash
   cd apps/mobile
   npx eas-cli@latest login
   npx eas-cli@latest init    # creates the project on expo.dev and shows its id
   ```

   `app.config.ts` is a dynamic config, so `eas init` may ask you to add the
   id yourself instead of writing it (step 2).
2. **Put in the project id** (a UUID), one of two ways:
   - `EXPO_PUBLIC_EAS_PROJECT_ID=<id>` in `apps/mobile/.env.local` (git ignores
     it) for local builds, plus the same variable in each EAS environment you
     build from (`npx eas-cli@latest env:set --name EXPO_PUBLIC_EAS_PROJECT_ID
     --value <id> --environment production --visibility plaintext`; repeat with
     `development` and `preview`). It must be plain text or sensitive, not
     secret, because EAS reads it while it resolves `app.config.ts`. Or:
   - `"extra": { "eas": { "projectId": "<id>" } }` under `expo` in `app.json`.
     It's a public identifier, so it can be committed.

   `app.config.ts` copies it into `extra.eas.projectId`, where the app
   (`src/lib/push.ts`) and EAS look for it. Check with
   `npx expo config --type public`.
3. **Turn on Push** on the web: sign in as a sysadmin → **System → AI &
   integrations → Email and push → Push**. Expo's push service needs no key.

Then use a development or store build (Expo Go on Android can't receive
pushes; iOS and Android each need their push credentials, below), sign in and
allow notifications. Settings → Notifications on the web then says push
notifications reach your phone.

**Android also needs Firebase (FCM)** — without it Android builds get no push
token (Me → Settings shows the Firebase error):

1. In the [Firebase console](https://console.firebase.google.com), create a
   project and add an Android app with the `android.package` from `app.json`.
2. Download its `google-services.json` into `apps/mobile/` and add
   `"googleServicesFile": "./google-services.json"` under `expo.android` in
   `app.json`. Do both together: a build fails if that line points at a
   missing file. The file holds only public identifiers, so it can be committed.
3. In Firebase → Project settings → Service accounts, generate a private key
   (keep it out of git), then run `npx eas-cli@latest credentials` → Android →
   production → Google Service Account → FCM V1 key → upload it. Expo's push
   service uses it to deliver to Android phones.

On iOS, the first `eas build` offers to create the Apple push key; say yes.

## Building for the App Store and Google Play (EAS)

```bash
npm install -g eas-cli          # or use npx eas-cli@latest
eas login
eas init                        # links the project (then step 2 of Push notifications → One-time setup)
eas build:configure             # creates eas.json
eas build --profile development --platform ios   # a dev build (Google sign-in, push)
eas build --platform all        # store builds
eas submit --platform ios       # / android
```

Before a store release:

- Replace the placeholder ids `edu.weber.wildcatclubs` (`ios.bundleIdentifier`,
  `android.package` in `app.json`) with the university's registered ones.
- Set `EXPO_PUBLIC_API_URL` to the production web address for the build (an EAS
  environment variable), and the Google client ids above.
- Replace the placeholder icon and splash in `assets/images` with WSU-approved
  artwork.
- For QR codes to open the app instead of the browser, add the web domain as
  iOS associated domains / Android app links (the in-app scanner works either
  way).

## Code map

```
src/app/              screens (expo-router)
  (tabs)/             Home, Scan, Clubs, Calendar, Notifications (inbox.tsx), Me
  welcome.tsx         sign in (Google / test personas)
  c/[code].tsx        the check-in flow (scan, typed code, pop-up, deep link)
  club/[slug].tsx     a club: Register / Subscribe, events, your attendance, pop-up
  event/[id].tsx      one meeting
src/api/              typed client; types.ts mirrors apps/web/src/app/api/m/_types.ts
src/auth/session.tsx  sign-in state, secure token storage, push registration
src/components/       shared UI (buttons, cards, rows, states, result views)
src/lib/              links, push, storage, data hook, formatting
src/theme.ts          colors (light + dark), spacing, type scale
```

Checks: `npx tsc --noEmit` and `npx expo export --platform web` (delete `dist/`
afterwards).
