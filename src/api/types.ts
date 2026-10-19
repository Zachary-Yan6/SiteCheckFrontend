/**
 * Shapes of the backend's JSON, mirroring the Java DTOs. Hand-written for now; can later be
 * generated from the backend's OpenAPI spec with openapi-typescript.
 */

export type Role = 'INSPECTOR' | 'MANAGER';

export interface User {
  id: number;
  email: string;
  fullName: string;
  role: Role;
}

export interface LoginResponse {
  token: string;
  expiresAt: string; // ISO-8601
  user: User;
}

export interface Schedule {
  templateId: number;
  lastInspectedAt: string | null; // null = never inspected
}

export interface Site {
  id: number;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  schedules: Schedule[];
}

export interface TemplateItem {
  id: number;
  position: number;
  title: string;
  guidance: string | null;
}

export interface Template {
  id: number;
  name: string;
  description: string | null;
  frequencyDays: number;
  items: TemplateItem[];
}

export interface BootstrapResponse {
  serverTime: string;
  sites: Site[];
  templates: Template[];
}

/** GET /api/manager/failed-items (FR-30). */
export interface FailedItem {
  inspectionId: string;
  siteId: number;
  siteName: string;
  templateName: string;
  position: number;
  itemTitle: string;
  note: string | null;
  submittedAt: string;
  inspectorName: string;
  photos: PhotoLink[];
}

export interface PhotoLink {
  id: string;
  /** Presigned link, valid for a few minutes only - fetch the list again to get fresh ones. */
  url: string;
  takenAt: string;
  latitude: number | null;
  longitude: number | null;
}

/** GET /api/sites/{siteId}/inspections (FR-09). */
export interface SiteInspection {
  id: string;
  templateName: string;
  inspectorName: string;
  submittedAt: string;
  itemCount: number;
  failCount: number;
  failedItems: string[];
}
