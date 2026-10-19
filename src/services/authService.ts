import axios from 'axios';
import type { UserSession } from '../types/auth';

const STORAGE_KEY_USER = 'gs_auth_user';
const STORAGE_KEY_HASH = 'gs_auth_hash';
const STORAGE_KEY_FIRSTNAME = 'gs_auth_firstname';
const STORAGE_KEY_USERID = 'gs_auth_userid';
const STORAGE_KEY_ROLEID = 'gs_auth_roleid';
const STORAGE_KEY_TIMESTAMP = 'gs_auth_timestamp';
const STORAGE_KEY_API_BASE = 'gs_auth_apibase';

/**
 * Authenticates user via the server-side login endpoint (/api/auth/login).
 * The master gateway credentials are kept strictly server-side and never reach the client bundle.
 */
export async function loginUser(username: string, password: string): Promise<UserSession> {
  const cleanUsername = username.trim();
  const rawPass = password.trim();

  try {
    const res = await axios.post('/api/auth/login', {
      username: cleanUsername,
      password: rawPass,
      deviceId: 'WEB_PWA_DEVICE'
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const resData = res.data;
    if (resData?.status === 1 && resData?.data?.isValid === true) {
      const data = resData.data;
      const userDto = data.userDto;
      const firstName = data.firstName || userDto?.firstName || cleanUsername;
      const rawUserId = data.userId || userDto?.userId || userDto?.id;
      const hashedPassword = data.passwordHash;
      const roleId = data.roleId ?? userDto?.roleId;
      const apiBaseUrl = data.apiBaseUrl;

      if (!rawUserId || !hashedPassword) {
        throw new Error('Authentication response failed: missing required credentials.');
      }

      const numericUserId = String(rawUserId);

      // Save user session details safely
      localStorage.setItem(STORAGE_KEY_USER, cleanUsername);
      localStorage.setItem(STORAGE_KEY_HASH, hashedPassword);
      localStorage.setItem(STORAGE_KEY_FIRSTNAME, firstName);
      localStorage.setItem(STORAGE_KEY_USERID, numericUserId);
      if (roleId !== undefined && roleId !== null) {
        localStorage.setItem(STORAGE_KEY_ROLEID, String(roleId));
      }
      localStorage.setItem(STORAGE_KEY_TIMESTAMP, String(Date.now()));
      const configuredEnvBase = (import.meta.env.VITE_API_BASE_URL as string)?.trim()?.replace(/\/+$/, '')?.replace(/\/api\/?$/i, '')?.replace(/\/+$/, '');
      const effectiveBase = configuredEnvBase || apiBaseUrl;
      if (effectiveBase) {
        localStorage.setItem(STORAGE_KEY_API_BASE, effectiveBase);
      }

      return {
        username: cleanUsername,
        passwordHash: hashedPassword,
        firstName,
        userId: numericUserId,
        roleId,
        loginTimestamp: Date.now(),
        isAuthenticated: true,
        apiBaseUrl
      };
    } else {
      throw new Error(resData?.message || 'Authentication failed. Please check credentials.');
    }
  } catch (err: any) {
    const errorMsg = err?.response?.data?.message || err?.message || 'Authentication failed. Please check credentials.';
    if (import.meta.env.DEV) {
      console.warn('Login failure:', errorMsg);
    }
    throw new Error(errorMsg);
  }
}

export function getStoredSession(): UserSession | null {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return null;
  }
  const username = localStorage.getItem(STORAGE_KEY_USER);
  const passwordHash = localStorage.getItem(STORAGE_KEY_HASH);
  const firstName = localStorage.getItem(STORAGE_KEY_FIRSTNAME) || '';
  const userId = localStorage.getItem(STORAGE_KEY_USERID) || '';
  const roleIdStr = localStorage.getItem(STORAGE_KEY_ROLEID);
  const timestampStr = localStorage.getItem(STORAGE_KEY_TIMESTAMP);
  const configuredEnvBase = (import.meta.env.VITE_API_BASE_URL as string)?.trim()?.replace(/\/+$/, '')?.replace(/\/api\/?$/i, '')?.replace(/\/+$/, '');
  const storedApiBase = localStorage.getItem(STORAGE_KEY_API_BASE)?.trim()?.replace(/\/+$/, '')?.replace(/\/api\/?$/i, '')?.replace(/\/+$/, '');

  // Detect environment switch: If configured env base changed from stored base, invalidate old session immediately
  if (configuredEnvBase && storedApiBase && storedApiBase !== configuredEnvBase) {
    clearSession();
    localStorage.setItem(STORAGE_KEY_API_BASE, configuredEnvBase);
    return null;
  }

  // Sync stored API base if not yet set
  if (configuredEnvBase && (!storedApiBase || storedApiBase !== configuredEnvBase)) {
    localStorage.setItem(STORAGE_KEY_API_BASE, configuredEnvBase);
  }

  const apiBaseUrl = configuredEnvBase || storedApiBase || undefined;

  // B-3: Check absolute session expiry (24 hours) to prevent stale session persistence
  const MAX_SESSION_MS = 24 * 60 * 60 * 1000;
  if (timestampStr && Date.now() - parseInt(timestampStr, 10) > MAX_SESSION_MS) {
    clearSession();
    return null;
  }

  if (username && passwordHash) {
    return {
      username,
      passwordHash,
      firstName,
      userId,
      roleId: roleIdStr ? parseInt(roleIdStr, 10) : undefined,
      loginTimestamp: timestampStr ? parseInt(timestampStr, 10) : undefined,
      isAuthenticated: true,
      apiBaseUrl
    };
  }
  return null;
}

export function clearSession(): void {
  const userId = localStorage.getItem(STORAGE_KEY_USERID);
  if (userId) {
    localStorage.removeItem(`gs:${userId}:notifications`);
  }
  localStorage.removeItem('gs_pwa_notifications');
  localStorage.removeItem(STORAGE_KEY_USER);
  localStorage.removeItem(STORAGE_KEY_HASH);
  localStorage.removeItem(STORAGE_KEY_FIRSTNAME);
  localStorage.removeItem(STORAGE_KEY_USERID);
  localStorage.removeItem(STORAGE_KEY_ROLEID);
  localStorage.removeItem(STORAGE_KEY_TIMESTAMP);
  localStorage.removeItem(STORAGE_KEY_API_BASE);
}

/**
 * Changes user password via /api/auth/change-password.
 */
export async function changePasswordApi(
  username: string,
  currentPass: string,
  newPass: string,
  confirmPass: string
): Promise<{ success: boolean; message: string }> {
  try {
    const res = await axios.post('/api/auth/change-password', {
      username: username.trim(),
      currentPassword: currentPass.trim(),
      newPassword: newPass.trim(),
      confirmPassword: confirmPass.trim()
    }, {
      headers: { 'Content-Type': 'application/json' }
    });

    if (res.data?.status === 1) {
      return {
        success: true,
        message: res.data?.message || 'Password changed successfully!'
      };
    }
    throw new Error(res.data?.message || 'Failed to change password');
  } catch (err: any) {
    const msg = err.response?.data?.message || err.message || 'Failed to change password. Please check your current password.';
    throw new Error(msg);
  }
}

/**
 * Resets user password via /api/auth/forgot-password.
 */
export async function forgotPasswordApi(
  username: string,
  newPass: string,
  confirmPass: string
): Promise<{ success: boolean; message: string }> {
  try {
    const res = await axios.post('/api/auth/forgot-password', {
      username: username.trim(),
      newPassword: newPass.trim(),
      confirmPassword: confirmPass.trim()
    }, {
      headers: { 'Content-Type': 'application/json' }
    });

    if (res.data?.status === 1) {
      return {
        success: true,
        message: res.data?.message || 'Password updated successfully!'
      };
    }
    throw new Error(res.data?.message || 'Failed to reset password');
  } catch (err: any) {
    const msg = err.response?.data?.message || err.message || 'Failed to reset password.';
    throw new Error(msg);
  }
}

