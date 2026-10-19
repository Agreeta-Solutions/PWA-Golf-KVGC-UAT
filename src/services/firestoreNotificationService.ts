import { getStoredSession } from './authService';
import { logSafeError } from '../utils/logger';
import type { HomeTaskUi } from '../types/task';
import type { NotificationItem } from './apiService';

// Firebase configuration loaded from environment
const FIREBASE_API_KEY =
  (import.meta.env.VITE_FIREBASE_API_KEY as string)?.trim() ||
  'AIzaSyCWU6bvQ-_kTZOQ0VDzZJ0lZDwuWYG6rNM';

const FIREBASE_PROJECT_ID =
  (import.meta.env.VITE_FIREBASE_PROJECT_ID as string)?.trim() ||
  'golf-mobile-501208';

const FIRESTORE_BASE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

/**
 * Formats a raw course name/code into canonical capitalization:
 *  - Standard uppercase acronyms (RACV, PGC, DLF, etc.) remain uppercase.
 *  - 'Pune' is canonicalized to 'PGC' (Pune Golf Club) matching Firestore collection schema.
 *  - Other course names (Kharghar, Dirab, Kalhaar, Jaypee, etc.) are PascalCase formatted.
 */
export function formatCourseCode(rawCourse: string): string {
  const trimmed = rawCourse.trim();
  const upper = trimmed.toUpperCase();
  if (upper === 'RACV' || upper === 'PGC' || upper === 'PUNE') {
    return upper === 'PUNE' ? 'PGC' : upper;
  }
  if (trimmed === upper && trimmed.length <= 5) {
    return upper;
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Dynamically parses the Golf Course code and environment suffix directly
 * from an API base URL (e.g. https://celesterra.agreeta.com/GolfCourse_Kharghar_WebAPI_UAT,
 * GolfCourse_RACV_WebAPI_Dev, GolfCourse_WebAPI_Dev, GolfCourse_Dirab_WebAPI_UAT, etc.)
 *
 * Supported formats:
 *  - GolfCourse_<Course>_WebAPI_<Env> (e.g. GolfCourse_Kharghar_WebAPI_UAT -> Kharghar, UAT)
 *  - GolfCourse_WebAPI_<Env> (No course specified in URL = Pune Golf Club / PGC)
 *  - <Course>_WebAPI_<Env>
 *  - Dynamic path segment inspection
 */
export function parseCourseAndEnvFromUrl(rawUrl: string): { courseCode: string; envSuffix: string } {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { courseCode: 'RACV', envSuffix: 'Dev' };
  }
  const clean = rawUrl.trim().replace(/\/api\/?$/i, '').replace(/\/+$/, '');

  // 1. Dynamic Environment extraction
  let envSuffix = 'Dev';
  if (/[_\-/.]UAT([_\-/.]|$)/i.test(clean) || clean.toUpperCase().endsWith('UAT')) {
    envSuffix = 'UAT';
  } else if (/[_\-/.]Staging([_\-/.]|$)/i.test(clean) || clean.toUpperCase().endsWith('STAGING')) {
    envSuffix = 'Staging';
  } else if (/[_\-/.]PRD([_\-/.]|$)/i.test(clean) || /[_\-/.]Prod(uction)?([_\-/.]|$)/i.test(clean) || clean.toUpperCase().endsWith('PRD')) {
    envSuffix = 'PRD';
  } else if (/[_\-/.]Dev([_\-/.]|$)/i.test(clean) || clean.toUpperCase().endsWith('DEV')) {
    envSuffix = 'Dev';
  } else if (/WebAPI$/i.test(clean)) {
    // Unadorned WebAPI is PRD in Agreeta production deployments
    envSuffix = 'PRD';
  }

  // 2. Dynamic Course extraction (completely dynamic without hardcoded course lists)
  let rawCourse = '';

  // Pattern A: GolfCourse_<Course>_WebAPI (e.g. GolfCourse_Kharghar_WebAPI_UAT, GolfCourse_Dirab_WebAPI_Dev)
  const matchGolf = clean.match(/GolfCourse_([A-Za-z0-9_-]+?)_WebAPI/i);
  if (matchGolf && matchGolf[1]) {
    rawCourse = matchGolf[1];
  } else if (/GolfCourse_WebAPI/i.test(clean)) {
    // Pattern B: GolfCourse_WebAPI without intermediate course name is canonical Pune Golf Club (PGC)
    rawCourse = 'PGC';
  } else {
    // Pattern C: <Course>_WebAPI
    const matchWeb = clean.match(/([A-Za-z0-9_-]+?)_WebAPI/i);
    if (matchWeb && matchWeb[1] && !['GolfCourse', 'Golf'].includes(matchWeb[1])) {
      rawCourse = matchWeb[1];
    } else {
      // Pattern D: Path segment inspection
      const segments = clean.split('/').filter(Boolean);
      const lastSeg = segments[segments.length - 1] || '';
      const matchSegment = lastSeg.match(/GolfCourse_([A-Za-z0-9_-]+)/i) || lastSeg.match(/([A-Za-z0-9_-]+)/);
      if (matchSegment && matchSegment[1]) {
        rawCourse = matchSegment[1];
      }
    }
  }

  const courseCode = formatCourseCode(rawCourse || 'RACV');
  return { courseCode, envSuffix };
}

/**
 * Dynamically resolves the active Firestore notification collection name.
 * 
 * NOT hardcoded:
 * Dynamically derives course identifier and environment suffix from the active API base URL
 * (VITE_API_BASE_URL, session.apiBaseUrl, or stored API base), or respects an explicit
 * VITE_FIRESTORE_COLLECTION override.
 *
 * Pattern: `Golf_${courseCode}_Notification_${envSuffix}`
 *
 * Examples:
 *  - Kharghar UAT (https://celesterra.agreeta.com/GolfCourse_Kharghar_WebAPI_UAT) -> Golf_Kharghar_Notification_UAT
 *  - Kharghar Dev (https://celesterra.agreeta.com/GolfCourse_Kharghar_WebAPI_Dev) -> Golf_Kharghar_Notification_Dev
 *  - Pune Dev (https://celesterra.agreeta.com/GolfCourse_WebAPI_Dev) -> Golf_PGC_Notification_Dev
 *  - Dirab UAT (https://celesterra.agreeta.com/GolfCourse_Dirab_WebAPI_UAT) -> Golf_Dirab_Notification_UAT
 *  - Dirab Dev (https://celesterra.agreeta.com/GolfCourse_Dirab_WebAPI_Dev) -> Golf_Dirab_Notification_Dev
 *  - RACV Dev (https://celesterra.agreeta.com/GolfCourse_RACV_WebAPI_Dev) -> Golf_RACV_Notification_Dev
 *  - RACV UAT (https://celesterra.agreeta.com/GolfCourse_RACV_WebAPI_UAT) -> Golf_RACV_Notification_UAT
 *  - Any other course (e.g. GolfCourse_Kalhaar_WebAPI_Dev) -> Golf_Kalhaar_Notification_Dev
 */
export function getFirestoreNotificationCollection(): string {
  // Respect explicit collection override if provided in environment
  const envOverride = (import.meta.env.VITE_FIRESTORE_COLLECTION as string)?.trim();
  if (envOverride) return envOverride;

  const configuredEnvBase = (import.meta.env.VITE_API_BASE_URL as string)?.trim() || '';
  const session = getStoredSession();
  const storedBase = (typeof localStorage !== 'undefined')
    ? (localStorage.getItem('gs_auth_apibase')?.trim() || '')
    : '';

  const activeApiUrl = configuredEnvBase || session?.apiBaseUrl || storedBase || '';
  const { courseCode, envSuffix } = parseCourseAndEnvFromUrl(activeApiUrl);

  return `Golf_${courseCode}_Notification_${envSuffix}`;
}

/**
 * Generates standard document ID matching the pattern used by the dashboard:
 * e.g. "Golf_RACV_Dev_20261019054246059_0212DDA9"
 */
function generateFirestoreDocumentId(collectionName: string): string {
  const prefix = collectionName.replace('_Notification_', '_');
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const min = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  const sss = String(now.getUTCMilliseconds()).padStart(3, '0');

  const timestamp = `${yyyy}${mm}${dd}${hh}${min}${ss}${sss}`;
  const randomHex = Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .toUpperCase()
    .padStart(8, '0');

  return `${prefix}_${timestamp}_${randomHex}`;
}

/**
 * Generates standard RFC4122 v4 UUID
 */
function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Parses Firestore typed document fields into a plain JavaScript key-value object.
 */
function parseFirestoreFields(fields: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  if (!fields) return result;

  for (const [key, val] of Object.entries(fields)) {
    if (!val || typeof val !== 'object') continue;
    if ('stringValue' in val) result[key] = val.stringValue;
    else if ('integerValue' in val) result[key] = val.integerValue;
    else if ('booleanValue' in val) result[key] = val.booleanValue;
    else if ('timestampValue' in val) result[key] = val.timestampValue;
    else if ('doubleValue' in val) result[key] = val.doubleValue;
    else result[key] = Object.values(val)[0];
  }
  return result;
}

function getCandidateCollections(primaryCollection: string): string[] {
  const list = [primaryCollection];
  const m = primaryCollection.match(/^Golf_([A-Za-z0-9_-]+)_Notification_([A-Za-z0-9]+)$/);
  if (m) {
    const course = m[1];
    const env = m[2];

    // If PGC, also allow reading Golf_Pune_Notification_<Env>
    if (course === 'PGC') {
      const puneCol = `Golf_Pune_Notification_${env}`;
      if (!list.includes(puneCol)) list.push(puneCol);
    } else if (course.toLowerCase() === 'pune') {
      const pgcCol = `Golf_PGC_Notification_${env}`;
      if (!list.includes(pgcCol)) list.push(pgcCol);
    }

    // Keep active environment RACV collection as secondary fallback if different
    const racvCol = `Golf_RACV_Notification_${env}`;
    if (!list.includes(racvCol)) {
      list.push(racvCol);
    }
  }
  return list;
}

/**
 * Dynamically resolves the receiver user ID for a task completion notification.
 *
 * CRITICAL REQUIREMENT: This is NEVER hardcoded.
 * Resolution hierarchy:
 *  1. Task's explicit createdBy or senderUserId property (from backend API).
 *  2. Search Firestore documents in active collection for any task assignment notification
 *     matching notification_task_id == task.id -> uses its notification_sender_user_id or created_by.
 *  3. Search Firestore for any notifications previously received by the current user ->
 *     uses the sender of the most recent task notification.
 *  4. Search Firestore for the latest active assigner in the collection.
 */
export async function resolveTaskReceiverId(
  task: HomeTaskUi,
  currentUsername: string
): Promise<string> {
  // 1. Direct check on task properties
  const taskCreator = (task as any).createdBy || (task as any).senderUserId || (task as any).assignedBy;
  if (taskCreator && typeof taskCreator === 'string' && taskCreator.trim().toLowerCase() !== currentUsername.toLowerCase()) {
    return taskCreator.trim();
  }

  // 2. Query Firestore collection to find who assigned this task
  try {
    const primaryCollection = getFirestoreNotificationCollection();
    const candidateCollections = getCandidateCollections(primaryCollection);

    for (const collectionName of candidateCollections) {
      const url = `${FIRESTORE_BASE_URL}/${collectionName}?key=${FIREBASE_API_KEY}`;
      const resp = await fetch(url);
      if (!resp.ok) continue;

      const data = await resp.json();
      const rawDocs = data.documents || [];
      if (rawDocs.length === 0) continue;

      // Look for a notification for this exact taskId
      const matched = rawDocs.find((d: any) => {
        const f = parseFirestoreFields(d.fields);
        return String(f.notification_task_id || '') === String(task.id);
      });

      if (matched) {
        const f = parseFirestoreFields(matched.fields);
        const assigner = f.notification_sender_user_id || f.created_by;
        if (assigner && typeof assigner === 'string' && assigner.trim().toLowerCase() !== currentUsername.toLowerCase()) {
          return assigner.trim();
        }
      }

      // If no exact task match, find previous tasks sent to this user
      const priorToUser = rawDocs.find((d: any) => {
        const f = parseFirestoreFields(d.fields);
        const r = (f.notification_receiver_user_id || '').toLowerCase();
        return r === currentUsername.toLowerCase() && f.notification_sender_user_id;
      });

      if (priorToUser) {
        const f = parseFirestoreFields(priorToUser.fields);
        const assigner = f.notification_sender_user_id || f.created_by;
        if (assigner && typeof assigner === 'string' && assigner.trim()) {
          return assigner.trim();
        }
      }

      // Check any recent sender in the collection
      for (const d of rawDocs) {
        const f = parseFirestoreFields(d.fields);
        const sender = f.notification_sender_user_id || f.created_by;
        if (sender && typeof sender === 'string' && sender.trim().toLowerCase() !== currentUsername.toLowerCase()) {
          return sender.trim();
        }
      }
    }
  } catch (err) {
    logSafeError('resolveTaskReceiverId', err);
  }

  // Fallback to domain supervisor or generic admin without static personal hardcoding
  const domain = currentUsername.includes('@') ? currentUsername.split('@')[1] : 'agreeta.com';
  return `admin@${domain}`;
}

/**
 * Stores a task completion notification in Firestore when marked as done from the PWA.
 */
export async function storeTaskCompletionNotification(task: HomeTaskUi): Promise<boolean> {
  const session = getStoredSession();
  const senderUserId = session?.username?.trim() || 'user';
  const collectionName = getFirestoreNotificationCollection();

  // Dynamically resolve receiver ID (NOT hardcoded)
  const receiverUserId = await resolveTaskReceiverId(task, senderUserId);

  const documentId = generateFirestoreDocumentId(collectionName);
  const notificationId = generateUuid();
  const nowIso = new Date().toISOString();

  const taskTitle = task.description || task.taskCategoryDescription || 'Task';
  const holeDesc = task.holeDescription || `Hole ${task.holeId}`;
  const opType = task.taskCategoryDescription || 'General';

  const numericTaskId = parseInt(String(task.id), 10);
  const taskIdField = !isNaN(numericTaskId)
    ? { integerValue: String(numericTaskId) }
    : { stringValue: String(task.id) };

  const payload = {
    fields: {
      document_id: { stringValue: documentId },
      created_by: { stringValue: senderUserId },
      created_date: { timestampValue: nowIso },
      modified_by: { stringValue: senderUserId },
      modified_date: { timestampValue: nowIso },
      notification_sent_date: { timestampValue: nowIso },
      notification_id: { stringValue: notificationId },
      notification_task_id: taskIdField,
      notification_hole_description: { stringValue: holeDesc },
      notification_operation_type: { stringValue: opType },
      notification_title: { stringValue: 'Task Completed' },
      notification_message: { stringValue: `Task '${taskTitle}' marked as completed.` },
      notification_is_read: { booleanValue: false },
      notification_sender_user_id: { stringValue: senderUserId },
      notification_receiver_user_id: { stringValue: receiverUserId }
    }
  };

  const createUrl = `${FIRESTORE_BASE_URL}/${collectionName}?documentId=${documentId}&key=${FIREBASE_API_KEY}`;

  try {
    const res = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      return true;
    } else {
      const errText = await res.text();
      logSafeError('storeTaskCompletionNotification Firestore response', errText);
      return false;
    }
  } catch (err) {
    logSafeError('storeTaskCompletionNotification fetch', err);
    return false;
  }
}

/**
 * Fetches notifications from the active Firestore collection.
 * Filters for the current logged-in user (receiver).
 */
export async function fetchFirestoreNotifications(username?: string): Promise<NotificationItem[]> {
  try {
    const primaryCollection = getFirestoreNotificationCollection();
    const candidateCollections = getCandidateCollections(primaryCollection);

    for (const collectionName of candidateCollections) {
      const url = `${FIRESTORE_BASE_URL}/${collectionName}?key=${FIREBASE_API_KEY}`;

      const resp = await fetch(url);
      if (!resp.ok) continue;

      const data = await resp.json();
      const rawDocs = data.documents || [];
      if (rawDocs.length === 0) continue;

      const userLower = (username || '').toLowerCase().trim();

      const items: NotificationItem[] = rawDocs
        .map((d: any) => {
          const f = parseFirestoreFields(d.fields);
          const docId = d.name ? d.name.split('/').pop() : f.document_id || f.notification_id;

          const sentDateStr = f.notification_sent_date || f.created_date;
          let formattedDate = 'Today';
          if (sentDateStr) {
            try {
              const dt = new Date(sentDateStr);
              formattedDate = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + dt.toLocaleDateString();
            } catch {
              formattedDate = String(sentDateStr);
            }
          }

          return {
            id: String(docId || f.notification_id),
            docName: d.name,
            taskId: f.notification_task_id != null ? String(f.notification_task_id) : undefined,
            title: f.notification_title || 'Task Notification',
            description: f.notification_message || f.notification_title || '',
            holeDescription: f.notification_hole_description || 'HOLE',
            operationType: (f.notification_operation_type || 'general').toLowerCase(),
            timestamp: formattedDate,
            rawTimestamp: sentDateStr ? new Date(sentDateStr).getTime() : 0,
            isRead: f.notification_is_read === true,
            receiverUserId: f.notification_receiver_user_id || '',
            senderUserId: f.notification_sender_user_id || ''
          };
        })
        // Filter for notifications intended for this user
        .filter((item: any) => {
          if (!userLower) return true;
          const rec = (item.receiverUserId || '').toLowerCase().trim();
          // Return if matches user, or if item is course broadcast (no receiver)
          return !rec || rec === userLower;
        })
        // Sort newest first
        .sort((a: any, b: any) => (b.rawTimestamp || 0) - (a.rawTimestamp || 0));

      if (items.length > 0) {
        return items;
      }
    }
  } catch (err) {
    logSafeError('fetchFirestoreNotifications', err);
  }

  return [];
}

/**
 * Updates notification_is_read to true in Firestore.
 */
export async function markFirestoreNotificationRead(docIdOrPath: string): Promise<boolean> {
  try {
    const collectionName = getFirestoreNotificationCollection();
    const docId = docIdOrPath.includes('/') ? docIdOrPath.split('/').pop() : docIdOrPath;
    const patchUrl = `${FIRESTORE_BASE_URL}/${collectionName}/${docId}?updateMask.fieldPaths=notification_is_read&key=${FIREBASE_API_KEY}`;

    const res = await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: {
          notification_is_read: { booleanValue: true }
        }
      })
    });

    return res.ok;
  } catch (err) {
    logSafeError('markFirestoreNotificationRead', err);
    return false;
  }
}
