# SiteCheck front end

Offline-first inspection app (Expo SDK 57, React Native, TypeScript, Expo Router, expo-sqlite).

## Run it

1. Start the backend from the SiteCheck repo: `docker compose up -d`, then `./mvnw spring-boot:run`.
2. `cp .env.example .env.local` and set `EXPO_PUBLIC_API_URL`:
   - Android emulator: `http://10.0.2.2:8080`
   - Real phone on the same Wi-Fi: `http://<your PC's LAN IP>:8080`
3. `npm install`
4. `npm start`, then press `a` for Android or scan the QR code with Expo Go.

## Layout

```
src/app/      screens (Expo Router - every file is a route)
src/api/      HTTP client and backend types
src/auth/     login state (Zustand) and the saved session (expo-secure-store)
src/db/       SQLite database, migrations and queries
src/sync/     talking to the server: bootstrap download, later the sync queue
```

## Checks

```
npm run typecheck
```
