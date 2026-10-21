# SiteCheck — Mobile App

[![Front end CI](https://github.com/Zachary-Yan6/SiteCheckFrontend/actions/workflows/ci.yml/badge.svg)](https://github.com/Zachary-Yan6/SiteCheckFrontend/actions/workflows/ci.yml)

Offline-first mobile app for **SiteCheck**, a safety inspection tool for construction sites. Built with Expo SDK 57, React Native, TypeScript, Expo Router and expo-sqlite.

Inspectors can do a full inspection with no signal at all: open a site, answer the checklist, photograph failures, sign, and submit. Everything is saved on the phone first and synced to the server automatically once the connection comes back. Managers use the same app to review failed items, share PDF reports and assign inspectors to sites.

> The backend (Spring Boot API) lives in a separate repository: **[SIteCheck](https://github.com/Zachary-Yan6/SIteCheck)**.

---

## Contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Screens](#screens)
- [How offline sync works](#how-offline-sync-works)
- [Project structure](#project-structure)
- [Scripts](#scripts)
- [CI](#ci)

---

## Features

**For inspectors**

- **Works offline** — the phone's SQLite database is the source of truth for everything the app shows. Sites, templates and due dates are downloaded once and cached.
- **Due-date overview** — each site shows whether its checks are overdue, due today or fine, most urgent first. Due dates are counted in calendar days in the phone's time zone.
- **Checklists with evidence** — every item is Pass / Fail / N/A. A failed item needs a note and at least one photo before the inspection can be submitted.
- **Compact photos** — photos are compressed to at most 500 KB and tagged with the time and GPS position at the moment they are taken. Location is only read when a photo is taken.
- **Signature** — a hand-drawn signature completes each inspection.
- **Automatic background sync** — with retries, exponential backoff and a banner showing what is still waiting or has failed.
- **Push reminders** — daily reminders for checks that are due; tapping one opens the right site.

**For managers**

- **Failed items** — filter by site and time range.
- **PDF reports** — download a site report and share it from the phone.
- **Assignments** — switch inspectors on or off for each site, including newly signed-up inspectors.

## Tech stack

| Area | Choice |
|------|--------|
| Framework | Expo SDK 57, React Native 0.86, React 19 (React Compiler enabled) |
| Language | TypeScript |
| Navigation | Expo Router (file-based, typed routes) |
| Local storage | expo-sqlite (WAL mode, versioned migrations) |
| State | Zustand |
| Session storage | expo-secure-store |
| Device features | expo-image-picker, expo-image-manipulator, expo-location, expo-notifications, NetInfo |
| Signature | react-native-signature-canvas |
| Tests | Jest (jest-expo), React Native Testing Library, 90% coverage gate |

## Getting started

### Prerequisites

- Node.js 24 and npm
- The [backend](https://github.com/Zachary-Yan6/SIteCheck) running locally
- An Android emulator, or a phone with **Expo Go** on the same Wi-Fi as your PC

### 1. Start the backend

In the backend repository:

```bash
docker compose up -d
```

```bash
./mvnw spring-boot:run
```

### 2. Point the app at the backend

```bash
cp .env.example .env.local
```

Then set `EXPO_PUBLIC_API_URL` in `.env.local`:

| Where the app runs | Value |
|--------------------|-------|
| Android emulator | `http://10.0.2.2:8080` (the default) |
| Real phone on the same Wi-Fi | `http://<your PC's LAN IP>:8080` |

For photo uploads from a real phone, the backend also needs `S3_PRESIGN_ENDPOINT` set to your PC's LAN IP — see the backend README.

### 3. Install and run

```bash
npm install
```

```bash
npm start
```

Press `a` to open the Android emulator, or scan the QR code with Expo Go.

### Demo accounts

All use the password `Password123!`.

| Email | Role |
|-------|------|
| `aoife.murphy@sitecheck.demo`  | Inspector |
| `liam.obrien@sitecheck.demo`   | Inspector |
| `siobhan.kelly@sitecheck.demo` | Manager |

## Screens

Every file in `src/app/` is a route.

| Route | Who | What it does |
|-------|-----|--------------|
| `login`, `register` | everyone | Log in, or sign up as a new inspector |
| `index` | Inspector | Assigned sites with their due status; pull to refresh |
| `site/[id]` | Inspector | A site's checks and inspection history; start an inspection |
| `inspection/[id]` | Inspector | Fill in the checklist, add notes and photos |
| `sign/[id]` | Inspector | Sign and submit (saved locally, then queued for sync) |
| `manager` | Manager | Failed items by site and time range; share a PDF report |
| `assign` | Manager | Assign inspectors to sites |

## How offline sync works

Submitting an inspection only writes to SQLite and adds it to a sync queue. The sync code is split in two:

- **`syncManager`** decides *when* to sync: when the phone comes back online, when the app returns to the foreground, on pull-to-refresh or submit, and on a timer for the next scheduled retry. Only one sync pass runs at a time.
- **`syncEngine`** decides *how*: upload the inspection, then upload each photo the server still needs (presigned S3 URL → upload → confirm).

Every step is safe to repeat. Inspections and photos have UUIDs generated on the phone and the backend treats a repeated submit as the same inspection, so "just try again" is a correct recovery for any failure, including the app being killed mid-sync.

Failed attempts are retried with exponential backoff — 30 s, 1 min, 2 min, 4 min… capped at 30 minutes, with ±20% jitter so a crew of phones regaining signal together doesn't hit the server at once. After 8 attempts, or on an error that will never succeed, the inspection is marked failed and waits for a manual retry from the sync banner. A rejected token stops the sync and asks the user to log in again.

The engine only talks to two interfaces (`SyncStore` for the local database, `SyncApi` for the server), so all the retry and ordering logic is unit-tested with fakes — no phone or network needed.

## Project structure

```
src/
├── app/            Screens (Expo Router — every file is a route)
├── api/            HTTP client and backend types
├── auth/           Login state (Zustand) and the saved session (expo-secure-store)
├── db/             SQLite database, migrations, cache and inspection repositories
├── inspection/     Submit rules and photo capture / compression
├── schedule/       Due-date rules and the due badge
├── sync/           Bootstrap download, sync engine, sync manager and banner
├── notifications/  Push registration and opening a site from a reminder
├── manager/        Manager API calls and UI pieces
├── site/           Site history API
└── test/           Test helpers and fakes (in-memory SQLite, mocked router)
```

Tests sit next to the code they cover as `*.test.ts(x)`.

## Scripts

| Command | What it does |
|---------|--------------|
| `npm start` | Start the Expo dev server |
| `npm run android` / `npm run ios` | Start and open on a device or emulator |
| `npm run typecheck` | TypeScript check (`tsc --noEmit`) |
| `npm run lint` | ESLint (`expo lint`) |
| `npm test` | Run the Jest tests |
| `npm run test:coverage` | Tests with coverage; fails below 90% statements, branches, functions or lines |

## CI

`.github/workflows/ci.yml` runs on every push to `main`/`master` and on every pull request: `npm ci`, then typecheck, lint, and the full test suite with the 90% coverage gate.
