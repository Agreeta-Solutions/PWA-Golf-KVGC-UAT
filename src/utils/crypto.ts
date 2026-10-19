/**
 * Encodes basic authentication header credentials.
 */
export function makeBasicAuthHeader(username: string, password: string): string {
  const token = btoa(`${username}:${password}`);
  return `Basic ${token}`;
}
