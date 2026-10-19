/**
 * Safe logging utility.
 * In development, logs sanitized error messages without leaking
 * sensitive request headers (e.g., Authorization) or exception objects.
 * In production, suppresses error output completely.
 */
export function logSafeError(context: string, err: any): void {
  if (import.meta.env.DEV) {
    const msg = err?.response?.data?.message || err?.message || (typeof err === 'string' ? err : 'Operation failed');
    console.warn(`[${context}]`, msg);
  }
}
