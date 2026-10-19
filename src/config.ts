/**
 * Backend base URL, from EXPO_PUBLIC_API_URL in mobile/.env.local (see .env.example).
 * The default works for the Android emulator, where 10.0.2.2 is the host PC's localhost.
 * On a real phone use the PC's LAN IP, e.g. http://192.168.1.20:8080.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:8080';
