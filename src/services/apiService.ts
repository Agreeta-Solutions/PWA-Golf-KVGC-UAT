import axios from 'axios';
import type { TaskListApiResponse, HomeTaskUi, TaskType } from '../types/task';
import type { HoleAreaResponse, LatLng, SatelliteDatesResponse, SatelliteGridResponse, SatelliteGridItem, ReferenceDataResponse, MowingDirectionDetail } from '../types/hole';
import { parseKMLCoordinates } from '../utils/kmlParser';
import { compressImage } from '../utils/imageUtils';
import { getStoredSession, clearSession } from './authService';
import { makeBasicAuthHeader } from '../utils/crypto';
import { logSafeError } from '../utils/logger';
import { latestEntryPerSection } from '../utils/mowingPatternResolver';
import {
  fetchFirestoreNotifications,
  markFirestoreNotificationRead,
  storeTaskCompletionNotification
} from './firestoreNotificationService';
export { storeTaskCompletionNotification };

// Always use local proxies to prevent CORS issues
const BASE_URL = '/api';

// Attach target API base header dynamically (supports Kharghar Dev, Pune Dev, RACV Dev per user session or .env switch)
axios.interceptors.request.use((config) => {
  const session = getStoredSession();
  const url = config.url || '';
  const configuredEnvBase = (import.meta.env.VITE_API_BASE_URL as string)?.trim()?.replace(/\/+$/, '')?.replace(/\/api\/?$/i, '')?.replace(/\/+$/, '');
  const targetBase = configuredEnvBase || session?.apiBaseUrl;
  // Only attach X-Target-Api-Base to internal /api calls, NEVER to external third-party APIs
  if (targetBase && (url.startsWith('/api') || (url.startsWith('/') && !url.startsWith('//'))) && !url.startsWith('/api/weather')) {
    config.headers['X-Target-Api-Base'] = targetBase;
  }
  return config;
});

// Handle 401 Unauthorized globally: automatically invalidate stale session and signal UI
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const isLoginRequest = error.config?.url?.includes('/api/auth/login');
    if (status === 401 && !isLoginRequest) {
      clearSession();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('gs_auth_unauthorized', {
          detail: { message: 'Session unauthorized or expired for this environment. Please sign in.' }
        }));
      }
    }
    return Promise.reject(error);
  }
);

// L1 In-Memory Cache Maps
const l1DatesCache = new Map<string, string[]>();
const l1PointsCache = new Map<string, SatelliteGridItem[]>();

export function clearL1GridCache(): void {
  l1DatesCache.clear();
  l1PointsCache.clear();
}

function getAuthHeader(): string {
  const session = getStoredSession();
  if (session && session.username && session.passwordHash) {
    return makeBasicAuthHeader(session.username, session.passwordHash);
  }
  return '';
}

function mapCategoryToTaskType(categoryDesc?: string): TaskType {
  if (!categoryDesc) return 'GENERAL';
  const lower = categoryDesc.toLowerCase();
  if (lower.includes('pest')) return 'PEST';
  if (lower.includes('fertilizer')) return 'FERTILIZER';
  if (lower.includes('veg') || lower.includes('stress') || lower.includes('turf')) return 'VEG_STRESS';
  if (lower.includes('moisture') || lower.includes('irrigation') || lower.includes('water')) return 'MOISTURE';
  if (lower.includes('general')) return 'GENERAL';
  return 'GENERAL';
}

function getStatusLabel(statusId?: number, fallback?: string): string {
  if (statusId === 18) return 'Completed';
  if (statusId === 16) return 'Assigned';
  if (statusId === 17) return 'Delayed';
  if (statusId === 15) return 'Unassigned';
  return fallback || 'Pending';
}

let cachedReferenceData: ReferenceDataResponse['data'] | undefined = (() => {
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem('gs_reference_data');
      if (raw) return JSON.parse(raw);
    } catch {}
  }
  return undefined;
})();
let inFlightReferenceDataPromise: Promise<ReferenceDataResponse['data'] | undefined> | null = null;

export function getCachedReferenceData(): ReferenceDataResponse['data'] | undefined {
  return cachedReferenceData;
}

export async function fetchReferenceData(): Promise<ReferenceDataResponse['data'] | undefined> {
  if (cachedReferenceData) {
    return cachedReferenceData;
  }
  if (inFlightReferenceDataPromise) {
    return inFlightReferenceDataPromise;
  }

  inFlightReferenceDataPromise = (async () => {
    try {
      const url = `${BASE_URL}/ReferenceData`;
      const authHeader = getAuthHeader();
      const response = await axios.get<ReferenceDataResponse>(url, {
        headers: {
          'Authorization': authHeader
        }
      });

      const data = response.data?.data;
      if (data) {
        cachedReferenceData = data;
        if (typeof localStorage !== 'undefined') {
          try {
            localStorage.setItem('gs_reference_data', JSON.stringify(data));
          } catch {}
        }
      }
      return data;
    } catch (err) {
      logSafeError('fetchReferenceData', err);
      return undefined;
    } finally {
      inFlightReferenceDataPromise = null;
    }
  })();

  return inFlightReferenceDataPromise;
}

export async function fetchTasks(holeId?: number | null, sectionId?: number | null): Promise<HomeTaskUi[]> {
  const authHeader = getAuthHeader();
  const hParam = (holeId !== undefined && holeId !== null) ? holeId : 'null';
  const sParam = (sectionId !== undefined && sectionId !== null) ? sectionId : 'null';
  const response = await axios.get<TaskListApiResponse>(`${BASE_URL}/Task?holeId=${hParam}&sectionId=${sParam}`, {
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json'
    }
  });

  const rawData: any = response.data?.data || response.data;
  const items: any[] = rawData?.taskdataList || (Array.isArray(rawData) ? rawData : []);

  return items.map((item, idx) => {
    const logs: any[] = item.taskLogs || [];
    const latestLog = logs.length > 0 ? [...logs].sort((a, b) => (b.taskLogId || 0) - (a.taskLogId || 0))[0] : null;
    const taskMedias: any[] = latestLog?.taskMedias || [];
    const imageUrl = taskMedias.length > 0 ? taskMedias[0]?.imageUrl : item.imageUrl;

    const logId = latestLog?.taskLogId || item.taskLogId || (typeof item.id === 'number' ? item.id : parseInt(String(item.id || idx), 10));
    const statusId = latestLog?.statusId;
    const isCompleted = statusId === 18 || !!item.isCompleted;

    const latVal = item.latitude != null ? (typeof item.latitude === 'number' ? item.latitude : parseFloat(String(item.latitude))) : undefined;
    const lngVal = item.longitude != null ? (typeof item.longitude === 'number' ? item.longitude : parseFloat(String(item.longitude))) : undefined;

    return {
      id: String(item.id || logId || idx),
      taskLogId: logId || null,
      holeId: item.holeId || 1,
      holeDescription: item.holeDescription || `Hole_${String(item.holeId || 1).padStart(2, '0')}`,
      sectionId: item.sectionId || undefined,
      sectionDescription: item.sectionDescription || undefined,
      taskCategoryId: item.taskCategoryId || 1,
      taskCategoryDescription: item.taskCategoryDescription || 'Task',
      description: item.description || item.taskCategoryDescription || 'Task Item',
      recommendation: item.recommendation || 'No recommendation provided.',
      statusDescription: getStatusLabel(statusId, item.statusDescription),
      expectedCompletionDate: item.expectedCompletionDate,
      scheduledDate: item.scheduledDate || undefined,
      labourHours: item.labourHours || 0,
      imageUrl: imageUrl || undefined,
      isCompleted,
      isUrgent: item.isUrgent === true || item.isUrgent === 1,
      type: mapCategoryToTaskType(item.taskCategoryDescription),
      latitude: (latVal && !isNaN(latVal) && latVal !== 0) ? latVal : undefined,
      longitude: (lngVal && !isNaN(lngVal) && lngVal !== 0) ? lngVal : undefined,
      createdBy: item.createdBy || item.CreatedBy || item.created_by || item.senderUserId || item.sender_user_id || item.assignedBy || item.AssignedBy || undefined,
      assignedTo: item.assignedTo || item.AssignedTo || item.assigned_to || item.receiverUserId || item.receiver_user_id || item.userId || undefined,
      senderUserId: item.createdBy || item.CreatedBy || item.created_by || item.senderUserId || item.sender_user_id || undefined
    };
  });
}

export async function completeTaskApi(task: HomeTaskUi): Promise<boolean> {
  const authHeader = getAuthHeader();
  const session = getStoredSession();
  if (!session || !session.userId) {
    throw new Error('Authentication required: user session is invalid.');
  }
  if (!task || !task.id) {
    throw new Error('Task completion error: invalid Task ID.');
  }

  const userId = parseInt(session.userId, 10);
  const taskId = parseInt(task.id, 10);
  const taskLogId = task.taskLogId ? (typeof task.taskLogId === 'number' ? task.taskLogId : parseInt(String(task.taskLogId), 10)) : taskId;

  const payload = {
    Id: taskId,
    HoleId: task.holeId,
    SectionId: task.sectionId ?? null,
    LabourHours: task.labourHours ?? 0.0,
    TaskCategoryId: task.taskCategoryId || 1,
    Description: task.description || '',
    Recommendation: task.recommendation || '',
    ExpectedCompletionDate: task.expectedCompletionDate || null,
    ScheduledDate: task.scheduledDate || null,
    IsUrgent: task.isUrgent ? 1 : 0,
    IsUpdate: 1,
    TaskLogs: [
      {
        TaskLogId: taskLogId,
        StatusId: 18, // MARK_AS_DONE = 18
        UserId: userId,
        IsUpdate: 1
      }
    ]
  };

  const response = await axios.post(`${BASE_URL}/Task`, payload, {
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json'
    }
  });

  return (
    response.data?.status === 1 ||
    response.data?.data?.status === 200 ||
    response.data?.data?.result?.taskID > 0 ||
    response.status === 200
  );
}

export async function uploadTaskMediaApi(taskLogId: number, imageFile: File): Promise<boolean> {
  const fileToUpload = await compressImage(imageFile).catch(() => imageFile);
  const authHeader = getAuthHeader();
  const session = getStoredSession();
  if (!session || !session.userId) {
    throw new Error('Upload error: user session is invalid.');
  }
  const userId = session.userId;

  const formData = new FormData();
  formData.append('TaskLogId', String(taskLogId));
  formData.append('UserId', userId);
  formData.append('file', fileToUpload);

  const headers: Record<string, string> = {};
  if (authHeader) {
    headers['Authorization'] = authHeader;
  }

  const response = await axios.post(`${BASE_URL}/TaskMedia`, formData, { headers });

  return response.data?.status === 1 || response.data?.data?.isValid === true || response.status === 200;
}

const l1KmlCache = new Map<number, Map<number, LatLng[]>>();
const holeSectionCache = new Map<number, Array<{ id: number; description: string }>>();
const inFlightHoleAreaPromises = new Map<number, Promise<Map<number, LatLng[]>>>();
const inFlightHoleSectionsPromises = new Map<number, Promise<Array<{ id: number; description: string }>>>();
const kmlTextCache = new Map<string, string>();

export function getCachedHoleSections(holeId: number): Array<{ id: number; description: string }> | undefined {
  return holeSectionCache.get(holeId);
}

export async function fetchHoleSections(holeId: number): Promise<Array<{ id: number; description: string }>> {
  if (holeSectionCache.has(holeId)) {
    return holeSectionCache.get(holeId)!;
  }
  if (inFlightHoleSectionsPromises.has(holeId)) {
    return inFlightHoleSectionsPromises.get(holeId)!;
  }

  const promise = (async () => {
    try {
      const url = `${BASE_URL}/HoleArea?holeId=${holeId}`;
      const authHeader = getAuthHeader();
      const response = await axios.get<HoleAreaResponse>(url, {
        headers: { 'Authorization': authHeader }
      });
      if (response.data && response.data.data) {
        const items = response.data.data;
        const holeSections = items
          .map(item => ({ id: item.sectionId, description: item.sectionDescription || '' }))
          .filter(it => it.id != null);
        if (holeSections.length > 0) {
          holeSectionCache.set(holeId, holeSections);
          return holeSections;
        }
      }
    } catch {
      // ignore
    } finally {
      inFlightHoleSectionsPromises.delete(holeId);
    }
    return [];
  })();

  inFlightHoleSectionsPromises.set(holeId, promise);
  return promise;
}

export async function getHoleSectionIds(holeId: number): Promise<number[]> {
  const sections = await fetchHoleSections(holeId);
  return sections.map(s => s.id);
}

const ALLOWED_KML_HOSTS = [
  'golf-course-kharghar-valley.s3.ap-south-1.amazonaws.com',
  'golf-course.s3.ap-south-1.amazonaws.com'
];

function isAllowedKmlHost(urlStr: string): boolean {
  try {
    const u = new URL(urlStr, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    if (typeof window !== 'undefined' && u.origin === window.location.origin) return true;
    return (
      ALLOWED_KML_HOSTS.includes(u.hostname) ||
      u.hostname.endsWith('.amazonaws.com') ||
      u.hostname.endsWith('.agreeta.com') ||
      u.hostname.includes('s3')
    );
  } catch {
    return false;
  }
}

export function getCachedHoleAreaPolygons(holeId: number): Map<number, LatLng[]> | undefined {
  if (l1KmlCache.has(holeId)) {
    return l1KmlCache.get(holeId)!;
  }

  // Check fast persistent localStorage cache for 0ms instant restoration
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(`gs_kml_${holeId}`);
      if (raw) {
        const parsed: Record<string, LatLng[]> = JSON.parse(raw);
        const map = new Map<number, LatLng[]>();
        Object.entries(parsed).forEach(([secIdStr, pts]) => {
          map.set(parseInt(secIdStr, 10), pts);
        });
        if (map.size > 0) {
          l1KmlCache.set(holeId, map);
          return map;
        }
      }
    } catch {
      // ignore
    }
  }

  // Fallback to sessionStorage
  if (typeof sessionStorage !== 'undefined') {
    try {
      const raw = sessionStorage.getItem(`gs_kml_${holeId}`);
      if (raw) {
        const parsed: Record<string, LatLng[]> = JSON.parse(raw);
        const map = new Map<number, LatLng[]>();
        Object.entries(parsed).forEach(([secIdStr, pts]) => {
          map.set(parseInt(secIdStr, 10), pts);
        });
        if (map.size > 0) {
          l1KmlCache.set(holeId, map);
          return map;
        }
      }
    } catch {
      // ignore
    }
  }

  return undefined;
}

export async function fetchHoleAreaPolygons(holeId: number): Promise<Map<number, LatLng[]>> {
  const cached = getCachedHoleAreaPolygons(holeId);
  if (cached && cached.size > 0) {
    return cached;
  }

  // Deduplicate in-flight requests for the same hole
  if (inFlightHoleAreaPromises.has(holeId)) {
    return inFlightHoleAreaPromises.get(holeId)!;
  }

  const promise = (async () => {
    const polygonMap = new Map<number, LatLng[]>();

    try {
      const url = `${BASE_URL}/HoleArea?holeId=${holeId}`;
      const authHeader = getAuthHeader();
      const response = await axios.get<HoleAreaResponse>(url, {
        headers: {
          'Authorization': authHeader
        }
      });

      if (response.data && response.data.data) {
        const items = response.data.data;
        const holeSections = items
          .map(item => ({ id: item.sectionId, description: item.sectionDescription || '' }))
          .filter(it => it.id != null);
        if (holeSections.length > 0) {
          holeSectionCache.set(holeId, holeSections);
        }

        await Promise.all(items.map(async (item) => {
          if (item.kmlData?.kmlUrl) {
            try {
              const rawKmlUrl = item.kmlData.kmlUrl;
              if (!isAllowedKmlHost(rawKmlUrl)) {
                logSafeError('fetchHoleAreaPolygons', new Error(`Untrusted KML host rejected: ${rawKmlUrl}`));
                return;
              }

              let kmlText = kmlTextCache.get(rawKmlUrl);
              if (!kmlText) {
                // Universal server proxy route with fast native fetch
                const kmlProxyUrl = `/api/kml-proxy?url=${encodeURIComponent(rawKmlUrl)}`;
                try {
                  const kmlRes = await fetch(kmlProxyUrl);
                  if (kmlRes.ok) {
                    kmlText = await kmlRes.text();
                  }
                } catch {
                  try {
                    const rawRes = await fetch(rawKmlUrl);
                    if (rawRes.ok) {
                      kmlText = await rawRes.text();
                    }
                  } catch (rawErr) {
                    logSafeError(`KML download for section ${item.sectionId}`, rawErr);
                  }
                }
                if (kmlText) {
                  kmlTextCache.set(rawKmlUrl, kmlText);
                }
              }

              if (kmlText) {
                const points = parseKMLCoordinates(kmlText);
                if (points.length > 0) {
                  polygonMap.set(item.sectionId, points);
                }
              }
            } catch (e) {
              logSafeError(`parseKML (section: ${item.sectionId})`, e);
            }
          }
        }));
      }
    } catch (err) {
      logSafeError(`fetchHoleAreaPolygons (holeId: ${holeId})`, err);
    } finally {
      inFlightHoleAreaPromises.delete(holeId);
    }

    if (polygonMap.size > 0) {
      l1KmlCache.set(holeId, polygonMap);
      const serializable: Record<string, LatLng[]> = {};
      polygonMap.forEach((pts, secId) => {
        serializable[String(secId)] = pts;
      });
      const jsonStr = JSON.stringify(serializable);
      if (typeof localStorage !== 'undefined') {
        try { localStorage.setItem(`gs_kml_${holeId}`, jsonStr); } catch {}
      }
      if (typeof sessionStorage !== 'undefined') {
        try { sessionStorage.setItem(`gs_kml_${holeId}`, jsonStr); } catch {}
      }
    }

    return polygonMap;
  })();

  inFlightHoleAreaPromises.set(holeId, promise);
  return promise;
}

const inFlightDatesPromises = new Map<string, Promise<string[]>>();
const inFlightPointsPromises = new Map<string, Promise<SatelliteGridItem[]>>();

export function getCachedSatelliteDates(
  holeId: number,
  sectionId: number | number[] | null,
  satelliteAnalysisId: number = 19
): string[] | undefined {
  const secIdStr = sectionId !== null ? (Array.isArray(sectionId) ? sectionId.join('-') : String(sectionId)) : 'all';
  const cacheKey = `dates_${holeId}_${secIdStr}_${satelliteAnalysisId}`;
  return l1DatesCache.get(cacheKey);
}

export function getCachedSatelliteGridData(
  holeId: number,
  sectionId: number | number[] | null,
  dateStr: string,
  satelliteAnalysisId: number = 19
): SatelliteGridItem[] | undefined {
  const secIdStr = sectionId !== null ? (Array.isArray(sectionId) ? sectionId.join('-') : String(sectionId)) : 'all';
  const cacheKey = `points_${holeId}_${secIdStr}_${dateStr}_${satelliteAnalysisId}`;
  return l1PointsCache.get(cacheKey);
}

export async function fetchSatelliteDates(
  holeId: number,
  sectionId: number | number[] | null,
  satelliteAnalysisId: number = 19,
  knownSectionIds?: number[]
): Promise<string[]> {
  const secIdStr = sectionId !== null ? (Array.isArray(sectionId) ? sectionId.join('-') : String(sectionId)) : 'all';
  const cacheKey = `dates_${holeId}_${secIdStr}_${satelliteAnalysisId}`;

  // 1. L1 Runtime Cache (only if non-empty data was cached)
  if (l1DatesCache.has(cacheKey) && l1DatesCache.get(cacheKey)!.length > 0) {
    return l1DatesCache.get(cacheKey)!;
  }

  // Deduplicate in-flight requests
  if (inFlightDatesPromises.has(cacheKey)) {
    return inFlightDatesPromises.get(cacheKey)!;
  }

  const promise = (async () => {
    try {
      const authHeader = getAuthHeader();
      let sectionIdsToQuery: number[] = [];
      if (sectionId !== null) {
        sectionIdsToQuery = Array.isArray(sectionId) ? sectionId : [sectionId];
      } else {
        let holeSecIds = knownSectionIds;
        if (!holeSecIds || holeSecIds.length === 0) {
          holeSecIds = await getHoleSectionIds(holeId);
        }
        sectionIdsToQuery = holeSecIds || [];
      }

      if (sectionIdsToQuery.length === 0) {
        return [];
      }

      const allDatesSet = new Set<string>();

      await Promise.all(
        sectionIdsToQuery.map(async (sId) => {
          try {
            const url = `${BASE_URL}/HoleArea?holeId=${holeId}&sectionId=${sId}&satelliteAnalysisId=${satelliteAnalysisId}`;
            const response = await axios.get<SatelliteDatesResponse>(url, {
              headers: { 'Authorization': authHeader },
              timeout: 6000
            });

            const rawData: any = response.data?.data || response.data;
            const datesList: any[] = rawData?.['satellite Dates'] || rawData?.satelliteDates || (Array.isArray(rawData) ? rawData : []);

            datesList.forEach(item => {
              if (item && item.date) {
                const dStr = String(item.date).split('T')[0];
                if (dStr) allDatesSet.add(dStr);
              }
            });
          } catch {
            // Ignore individual section date errors
          }
        })
      );

      const dates = Array.from(allDatesSet).sort((a, b) => b.localeCompare(a));

      if (dates.length > 0) {
        l1DatesCache.set(cacheKey, dates);
      }

      return dates;
    } catch (err) {
      logSafeError('fetchSatelliteDates', err);
      return [];
    } finally {
      inFlightDatesPromises.delete(cacheKey);
    }
  })();

  inFlightDatesPromises.set(cacheKey, promise);
  return promise;
}

export async function fetchSatelliteGridData(
  holeId: number,
  sectionId: number | number[] | null,
  dateStr: string,
  satelliteAnalysisId: number = 19,
  knownSectionIds?: number[]
): Promise<SatelliteGridItem[]> {
  const secIdStr = sectionId !== null ? (Array.isArray(sectionId) ? sectionId.join('-') : String(sectionId)) : 'all';
  const cacheKey = `points_${holeId}_${secIdStr}_${dateStr}_${satelliteAnalysisId}`;

  // 1. L1 Runtime Cache (only if non-empty data was cached)
  if (l1PointsCache.has(cacheKey) && l1PointsCache.get(cacheKey)!.length > 0) {
    return l1PointsCache.get(cacheKey)!;
  }

  // Deduplicate in-flight requests
  if (inFlightPointsPromises.has(cacheKey)) {
    return inFlightPointsPromises.get(cacheKey)!;
  }

  const promise = (async () => {
    try {
      const authHeader = getAuthHeader();
      let sectionIdsToQuery: number[] = [];
      if (sectionId !== null) {
        sectionIdsToQuery = Array.isArray(sectionId) ? sectionId : [sectionId];
      } else {
        let holeSecIds = knownSectionIds;
        if (!holeSecIds || holeSecIds.length === 0) {
          holeSecIds = await getHoleSectionIds(holeId);
        }
        sectionIdsToQuery = holeSecIds || [];
      }

      if (sectionIdsToQuery.length === 0) {
        return [];
      }
      
      const allPoints: SatelliteGridItem[] = [];

      await Promise.all(
        sectionIdsToQuery.map(async (sId) => {
          try {
            const url = `${BASE_URL}/HoleArea?holeId=${holeId}&sectionId=${sId}&SSMADate=${dateStr}&satelliteAnalysisId=${satelliteAnalysisId}`;
            const response = await axios.get<SatelliteGridResponse>(url, {
              headers: { 'Authorization': authHeader },
              timeout: 6000
            });

            const rawData: any = response.data?.data || response.data;
            const items: any[] = 
              rawData?.satellitePoints || 
              rawData?.['satellite Analysis Details'] || 
              rawData?.['satellite Dates'] || 
              (Array.isArray(rawData) ? rawData : []);

            items.forEach((item: any) => {
              const lat = Number(item.latitude || item.Latitude || item.lat || 0);
              const lng = Number(item.longitude || item.Longitude || item.lng || 0);
              const cc = String(item.colour_code || item.ColourCode || item.colourCode || item.colourId || item.colour_id || item.color || '');
              if (lat !== 0 && lng !== 0 && cc !== '') {
                allPoints.push({
                  hole_id: holeId,
                  section_id: sId,
                  latitude: lat,
                  longitude: lng,
                  colour_code: cc
                });
              }
            });
          } catch {
            // Ignore individual section point errors
          }
        })
      );

      if (allPoints.length > 0) {
        l1PointsCache.set(cacheKey, allPoints);
      }

      return allPoints;
    } catch (err) {
      logSafeError('fetchSatelliteGridData', err);
      return [];
    } finally {
      inFlightPointsPromises.delete(cacheKey);
    }
  })();

  inFlightPointsPromises.set(cacheKey, promise);
  return promise;
}

export function prefetchAdjacentHole(currentHoleId: number): void {
  const nextHoleId = (currentHoleId % 18) + 1;
  const schedule = typeof window !== 'undefined' && 'requestIdleCallback' in window
    ? (cb: () => void) => (window as any).requestIdleCallback(cb, { timeout: 3000 })
    : (cb: () => void) => setTimeout(cb, 1000);

  schedule(() => {
    if (!l1KmlCache.has(nextHoleId)) {
      fetchHoleAreaPolygons(nextHoleId).catch(() => {});
    }
  });
}

export interface NotificationItem {
  id: string;
  taskId?: string;
  title: string;
  description: string;
  holeDescription: string;
  operationType: string;
  timestamp: string;
  isHighlighted?: boolean;
  /** Read / unread state (notification_is_read in Firestore). Unread items are shown in green. */
  isRead?: boolean;
}

/** Normalises the API's read flag (true / "true" / 1) whatever casing the field arrives in. */
function parseIsRead(item: any): boolean {
  const raw =
    item?.isRead ?? item?.IsRead ?? item?.notificationIsRead ?? item?.NotificationIsRead ??
    item?.notification_is_read ?? item?.is_read ?? item?.read;
  return raw === true || raw === 1 || String(raw).toLowerCase() === 'true';
}

/** Marks one notification as read in the locally stored list and returns the updated list. */
export function markNotificationRead(id: string): NotificationItem[] {
  const updated = getLocalNotifications().map(n => (n.id === id ? { ...n, isRead: true } : n));
  saveLocalNotifications(updated);
  // Also sync read state to Firestore asynchronously
  markFirestoreNotificationRead(id).catch(() => {});
  return updated;
}

function getNotificationsStorageKey(): string {
  const session = getStoredSession();
  return session?.userId ? `gs:${session.userId}:notifications` : 'gs_pwa_notifications';
}

function getLocalNotifications(): NotificationItem[] {
  try {
    const raw = localStorage.getItem(getNotificationsStorageKey());
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    logSafeError('reading local notifications', e);
  }
  return [];
}

export function saveLocalNotifications(list: NotificationItem[]): void {
  try {
    localStorage.setItem(getNotificationsStorageKey(), JSON.stringify(list));
  } catch (e) {
    logSafeError('saving local notifications', e);
  }
}

export function triggerSystemNotification(title: string, body: string): void {
  if (typeof window !== 'undefined' && 'Notification' in window) {
    if (Notification.permission === 'granted') {
      const options = {
        body,
        icon: '/logo.svg',
        badge: '/logo.svg',
        vibrate: [200, 100, 200]
      };
      if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(reg => {
          reg.showNotification(title, options);
        }).catch(() => {
          try { new Notification(title, options); } catch {}
        });
      } else {
        try { new Notification(title, options); } catch {}
      }
    } else if (Notification.permission === 'default') {
      try { Notification.requestPermission(); } catch {}
    }
  }
}

export function addNewTaskNotification(task: HomeTaskUi): NotificationItem[] {
  const current = getLocalNotifications();
  const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' Today';
  const newNotif: NotificationItem = {
    id: `notif_${Date.now()}_${task.id}`,
    taskId: String(task.id),
    title: `New Task Assigned: ${task.taskCategoryDescription}`,
    description: task.description || task.recommendation || `Inspection task assigned for ${task.holeDescription}`,
    holeDescription: task.holeDescription || 'HOLE',
    operationType: (task.taskCategoryDescription || 'general').toLowerCase(),
    timestamp: nowStr,
    isHighlighted: true,
    isRead: false
  };

  const updated = [newNotif, ...current.map(n => ({ ...n, isHighlighted: false }))];
  saveLocalNotifications(updated);

  triggerSystemNotification(newNotif.title, `${newNotif.holeDescription}: ${newNotif.description}`);

  return updated;
}

export async function fetchNotificationsApi(): Promise<NotificationItem[]> {
  const localItems = getLocalNotifications();
  const session = getStoredSession();

  try {
    // 1. Fetch live notifications from Firestore
    const firestoreItems = await fetchFirestoreNotifications(session?.username);
    if (firestoreItems && firestoreItems.length > 0) {
      // Merge with any local items
      const merged = [...firestoreItems];
      localItems.forEach(local => {
        if (!merged.some(m => m.id === local.id || (m.title === local.title && m.description === local.description))) {
          merged.push({ ...local, isHighlighted: false });
        }
      });
      saveLocalNotifications(merged);
      return merged;
    }
  } catch (err) {
    logSafeError('fetchNotificationsApi (Firestore)', err);
  }

  // 2. Fallback: try upstream API if available
  try {
    const authHeader = getAuthHeader();
    if (session && session.userId) {
      const userId = session.userId;
      const response = await axios.get(`${BASE_URL}/Notification?userId=${userId}&receiverUserId=${userId}`, {
        headers: {
          'Authorization': authHeader
        }
      });

      const rawData: any = response.data?.data || response.data;
      const items: any[] = Array.isArray(rawData) ? rawData : (rawData?.notificationList || rawData?.notifications || []);

      if (items.length > 0) {
        const serverNotifs: NotificationItem[] = items.map((item, idx) => ({
          id: String(item.id || item.Id || idx),
          taskId: item.taskId != null ? String(item.taskId) : undefined,
          title: item.title || item.Title || 'Task Alert',
          description: item.message || item.Message || item.description || '',
          holeDescription: item.holeDescription || item.HoleDescription || 'HOLE',
          operationType: (item.operationType || item.OperationType || 'general').toLowerCase(),
          timestamp: item.createdDate || item.CreatedDate || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isHighlighted: idx === 0,
          isRead: parseIsRead(item) || localItems.some(l => l.id === String(item.id || item.Id || idx) && l.isRead)
        }));

        const merged = [...serverNotifs];
        localItems.forEach(local => {
          if (!merged.some(m => m.title === local.title && m.description === local.description)) {
            merged.push({ ...local, isHighlighted: false });
          }
        });
        saveLocalNotifications(merged);
        return merged;
      }
    }
  } catch {
    // Upstream fallback endpoint failed or not supported
  }

  return localItems;
}

// Mowing directions can change from the dashboard at any time, so cached results expire.
const MOWING_CACHE_TTL_MS = 2 * 60 * 1000;
const l1MowingCache = new Map<string, { details: MowingDirectionDetail[]; at: number }>();

function readMowingCache(cacheKey: string): MowingDirectionDetail[] | undefined {
  const hit = l1MowingCache.get(cacheKey);
  if (!hit) return undefined;
  if (Date.now() - hit.at > MOWING_CACHE_TTL_MS) {
    l1MowingCache.delete(cacheKey);
    return undefined;
  }
  return hit.details;
}
const inFlightMowingPromises = new Map<string, Promise<MowingDirectionDetail[]>>();

export function getCachedMowingDirections(
  holeId: number,
  sectionId?: number | null,
  mowingDate?: string
): MowingDirectionDetail[] | undefined {
  const dateParam = mowingDate || new Date().toISOString().split('T')[0];
  const cacheKey = `mow_${holeId}_${sectionId ?? 'all'}_${dateParam}`;
  return readMowingCache(cacheKey);
}

/**
 * GET that retries on 429 Too Many Requests (server or Lambda throttling), waiting for
 * Retry-After when given, otherwise 0.5 s then 1.5 s.
 */
async function getWithRetryOn429<T = any>(url: string, config: Record<string, any>, retries = 2): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await axios.get<T>(url, config);
    } catch (err: any) {
      if (err?.response?.status !== 429 || attempt >= retries) throw err;
      const retryAfterSec = Number(err.response.headers?.['retry-after']);
      const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? Math.min(retryAfterSec * 1000, 5000)
        : 500 * Math.pow(3, attempt);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }
}

/**
 * Fetches mowing directions for a hole and section on a specific date.
 * Matches Android TaskApiService.kt: @GET("api/Mowing/") query holeId, sectionId, mowingDate.
 */
export async function fetchMowingDirections(
  holeId: number,
  sectionId?: number | null,
  mowingDate?: string
): Promise<MowingDirectionDetail[]> {
  const dateParam = mowingDate || new Date().toISOString().split('T')[0];
  const cacheKey = `mow_${holeId}_${sectionId ?? 'all'}_${dateParam}`;

  const cached = readMowingCache(cacheKey);
  if (cached) {
    return cached;
  }

  if (inFlightMowingPromises.has(cacheKey)) {
    return inFlightMowingPromises.get(cacheKey)!;
  }

  const promise = (async () => {
    try {
      const authHeader = getAuthHeader();

      const params: Record<string, string | number> = {
        holeId,
        mowingDate: dateParam
      };
      if (sectionId !== undefined && sectionId !== null) {
        params.sectionId = sectionId;
      }

      const queryString = Object.entries(params)
        .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
        .join('&');

      let response: any;
      try {
        // Primary: Android TaskApiService.kt uses @GET("api/Mowing/")
        response = await getWithRetryOn429(`${BASE_URL}/Mowing/?${queryString}`, {
          headers: { 'Authorization': authHeader },
          timeout: 8000
        });
      } catch (err: any) {
        if (err?.response?.status === 404 || err?.response?.status === 405 || !err?.response) {
          response = await getWithRetryOn429(`${BASE_URL}/Mowing?${queryString}`, {
            headers: { 'Authorization': authHeader },
            timeout: 8000
          });
        } else {
          throw err;
        }
      }

      const body = response?.data;
      if (!body) return [];

      const isSuccess = body.status === 1 || body.Status === 1 || response.status === 200;
      const rawData = body.data || body.Data || body;

      if (isSuccess && rawData) {
        const rawList =
          rawData.mowingDirectionDetails ||
          rawData.MowingDirectionDetails ||
          rawData.mowingDetails ||
          rawData.MowingDetails ||
          (Array.isArray(rawData) ? rawData : []);

        if (Array.isArray(rawList)) {
          const toNum = (v: any): number | undefined =>
            v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined;
          const allEntries: MowingDirectionDetail[] = rawList
            .filter((d: any) => d && (d.mowingDirection || d.MowingDirection || d.direction || d.Direction))
            .map((d: any) => ({
              id: toNum(d.id ?? d.Id ?? d.mowingId ?? d.MowingId),
              mowingDetailId: toNum(d.mowingDetailId ?? d.MowingDetailId),
              mowingDate: d.mowingDate || d.MowingDate || d.date || d.Date || '',
              hole: d.hole || d.Hole || d.holeDescription || d.HoleDescription || '',
              section: d.section || d.Section || d.sectionDescription || d.SectionDescription || '',
              mowingType: d.mowingType || d.MowingType || '',
              mowingDirection: d.mowingDirection || d.MowingDirection || d.direction || d.Direction || ''
            }));

          // The API keeps every earlier save; only the newest entry per section is current.
          const details = latestEntryPerSection(allEntries);

          // Cache empty results too, so sections with no mowing entry are not re-requested
          // on every reload (expires with MOWING_CACHE_TTL_MS like any other result).
          l1MowingCache.set(cacheKey, { details, at: Date.now() });
          return details;
        }
      }
      return [];
    } catch (err) {
      logSafeError('fetchMowingDirections', err);
      return [];
    } finally {
      inFlightMowingPromises.delete(cacheKey);
    }
  })();

  inFlightMowingPromises.set(cacheKey, promise);
  return promise;
}

/**
 * Fetches mowing directions in parallel for each section on a hole,
 * returning a map keyed by sectionId, exactly matching Android TaskViewModel.kt.
 */
export async function fetchMowingDirectionsSectionWise(
  holeId: number,
  sectionIds: number[],
  date: string,
  rawSections?: Array<{ id: number; description: string }>
): Promise<Map<number, MowingDirectionDetail[]>> {
  const bySection = new Map<number, MowingDirectionDetail[]>();
  let distinctIds = Array.from(new Set(sectionIds)).filter(id => id != null && !isNaN(id));

  // If sectionIds is empty, dynamically retrieve hole sections from cache or API
  if (distinctIds.length === 0) {
    const holeSecs = await fetchHoleSections(holeId);
    if (holeSecs.length > 0) {
      distinctIds = holeSecs.map(s => s.id);
    }
  }

  // 1. Hole-level mowing directions (sectionId omitted) are only a fallback for when the hole's
  // sections are unknown. The Web API rejects api/Mowing without a sectionId (405 Method Not
  // Allowed), so when we have section ids we go straight to the per-section calls below.
  try {
    const holeWideDetails = distinctIds.length === 0
      ? await fetchMowingDirections(holeId, null, date)
      : [];
    if (holeWideDetails && holeWideDetails.length > 0) {
      const holeSecs = holeSectionCache.get(holeId) || [];
      holeWideDetails.forEach(d => {
        const secDesc = (d.section || '').trim().toLowerCase();
        if (!secDesc) return;

        // A. Match against rawSections
        if (rawSections && rawSections.length > 0) {
          const match = rawSections.find(s => {
            const desc = s.description.trim().toLowerCase();
            return desc === secDesc || desc.startsWith(secDesc) || secDesc.startsWith(desc);
          });
          if (match) {
            const list = bySection.get(match.id) || [];
            if (!list.some(m => m.mowingDirection === d.mowingDirection && m.mowingType === d.mowingType)) {
              list.push(d);
            }
            bySection.set(match.id, list);
          }
        }

        // B. Match against distinctIds (the hole's actual sections and polygon IDs)
        distinctIds.forEach(sId => {
          const sDesc = (holeSecs.find(h => h.id === sId)?.description ||
                         rawSections?.find(r => r.id === sId)?.description || '').trim().toLowerCase();
          if (sDesc && (sDesc === secDesc || sDesc.startsWith(secDesc) || secDesc.startsWith(sDesc))) {
            const list = bySection.get(sId) || [];
            if (!list.some(m => m.mowingDirection === d.mowingDirection && m.mowingType === d.mowingType)) {
              list.push(d);
            }
            bySection.set(sId, list);
          }
        });
      });
    }
  } catch {
    // ignore
  }

  if (distinctIds.length === 0) {
    return bySection;
  }

  // 2. Fetch mowing directions for each section on the hole (matching Android TaskViewModel.kt),
  // at most 2 requests at a time so a hole with many sections does not trigger 429 throttling.
  const MOWING_CONCURRENCY = 2;
  const results: Array<{ secId: number; details: MowingDirectionDetail[] }> = [];
  for (let i = 0; i < distinctIds.length; i += MOWING_CONCURRENCY) {
    const batch = await Promise.all(
      distinctIds.slice(i, i + MOWING_CONCURRENCY).map(async (secId) => {
        try {
          const details = await fetchMowingDirections(holeId, secId, date);
          return { secId, details };
        } catch {
          return { secId, details: [] as MowingDirectionDetail[] };
        }
      })
    );
    results.push(...batch);
  }

  results.forEach(({ secId, details }) => {
    if (details && details.length > 0) {
      const existing = bySection.get(secId) || [];
      const merged = [...existing];
      details.forEach(d => {
        if (!merged.some(m => m.mowingDirection === d.mowingDirection && m.mowingType === d.mowingType)) {
          merged.push(d);
        }
      });
      bySection.set(secId, merged);
    } else if (!bySection.has(secId)) {
      bySection.set(secId, []);
    }
  });

  return bySection;
}

