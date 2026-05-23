# AccoRadar

AccoRadar is a React + Vite + Firebase dashboard for tracking multiple Gmail accounts used with Codex. It parses pasted limit messages, calculates reset availability, ranks accounts from best to worst, and provides separate public and admin experiences for day-to-day operations.

## What the app does

- Stores account records in a Firestore `accounts` collection.
- Parses pasted Codex rate-limit messages to detect reset time.
- Calculates live countdowns and account status in real time.
- Sorts accounts from most usable to least usable.
- Tracks last-used activity and usage history.
- Shows operational analytics for readiness, usage patterns, and reset backlog.

## Public dashboard

The public dashboard is read-only and requires no authentication.

- View all tracked accounts in ranked order.
- See compact status, countdown, reset time, last used time, and score.
- Monitor live countdown updates without editing access.
- Review summary metrics and analytics cards.

## Admin dashboard

The admin dashboard is protected with Firebase Authentication and only allows the approved admin email to edit data.

- Create accounts from a drawer opened by the `+` action in the top bar.
- Edit account details in a compact side drawer.
- Delete accounts.
- Load a copied limit message into an account with the `Limit` action.
- Mark an account as used immediately with the `Use` action.
- Update parsing, scoring, and ordering instantly after any change.

## Account status meanings

- `Green`: available now, healthy, or reset time already passed.
- `Yellow`: not ready yet, but the reset window is close.
- `Red`: currently blocked, missing a reliable reset time, or still waiting a longer period.

## Analytics section

The dashboard includes practical analytics panels:

- Availability distribution by green / yellow / red status.
- Ready-now account list.
- Most-used and least-used account rankings.
- Accounts waiting the longest before reset.
- Usage activity over the last seven days when history is available.

Usage analytics are driven by `usageCount` and `usageHistory`, which are updated whenever the admin uses the one-click `Use` action.

## Firebase setup

The app uses Firebase Authentication and Cloud Firestore. The client-side Firebase config is public application config only and is stored in `src/lib/firebase.js`. Do not place admin passwords, service account JSON files, or other secrets in source control.

### Required Firebase services

1. Enable `Email/Password` in Firebase Authentication.
2. Create the admin auth user with this exact email:
   `hashhash4uhell@gmail.com`
3. Deploy the Firestore security rules from `firestore.rules`.
4. Add the GitHub Pages domain to Firebase Authentication authorized domains if needed.

## Firestore collection structure

Collection name:

`accounts`

Recommended document shape:

```json
{
  "name": "Account 01",
  "email": "example@gmail.com",
  "limitMessage": "Original pasted Codex limit message",
  "status": "green",
  "resetAt": "Firestore Timestamp or null",
  "lastUsedAt": "Firestore Timestamp or null",
  "countdownText": "Ready now",
  "score": 382,
  "notes": "Optional internal notes",
  "orderIndex": 1,
  "parserState": "parsed",
  "detectedIntent": "limited",
  "parsedResetSource": "May 26, 2026, 3:58 PM",
  "usageCount": 4,
  "usageHistory": ["2026-05-23T09:10:00.000Z"],
  "createdAt": "Firestore Timestamp",
  "updatedAt": "Firestore Timestamp"
}
```

## Authentication requirements

- Public dashboard: no login required.
- Admin dashboard: Firebase Authentication required.
- Only `hashhash4uhell@gmail.com` should have write access.
- Firestore rules must enforce the same restriction as the UI.

## Local development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the Vite development server:

   ```bash
   npm run dev
   ```

3. Open the local URL shown by Vite.

4. Make sure Firebase Authentication and Firestore are already configured for the project before testing admin actions.

## GitHub Pages deployment

The project already includes the GitHub Pages base path in `vite.config.js`.

1. Build the production bundle:

   ```bash
   npm run build
   ```

2. Deploy to GitHub Pages:

   ```bash
   npm run deploy
   ```

3. After deploying, verify:
   - the GitHub Pages URL is authorized in Firebase Authentication
   - Firestore rules are deployed
   - the admin account can sign in successfully

## Security notes

- Do not store admin passwords in the repository.
- Do not commit `.env` files or service-account credentials.
- Only public Firebase client config belongs in frontend code.
- If you introduce any new local Firebase setup files, keep them gitignored.

## Maintenance notes

- Countdown and sorting logic live in `src/lib/account-utils.js`.
- Usage analytics helpers live in `src/lib/dashboard-analytics.js`.
- Firebase client setup lives in `src/lib/firebase.js`.
- Firestore write protection lives in `firestore.rules`.
