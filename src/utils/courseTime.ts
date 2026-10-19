/**
 * Course-local time helpers.
 *
 * The course timezone (e.g. "Australia/Melbourne") is learned from the Open-Meteo response,
 * which is requested with timezone=auto, so it always follows the course coordinates.
 *
 *   courseNow()        -> a Date whose local getters read course wall-clock values (display / "today" only;
 *                         never call .toISOString() on it or send it to a server)
 *   courseToday()      -> 'YYYY-MM-DD' at the course
 *   courseHourKey()    -> 'YYYY-MM-DDTHH' at the course, comparable with Open-Meteo hourly.time strings
 *   formatInCourseTz() -> renders a stored UTC instant in course time: 'DD/MM/YYYY, h:mm AM'
 */

const TZ_KEY = 'gs_course_tz';

/** Cache the course timezone. Call with `data.timezone` from the weather response. */
export function setCourseTz(tz: unknown): void {
  // A real IANA zone always contains "/" (rejects "UTC" fallbacks and "auto").
  if (typeof tz !== 'string' || !tz.includes('/')) return;
  try {
    localStorage.setItem(TZ_KEY, tz);
  } catch {
    /* private mode */
  }
}

export function courseTz(): string | null {
  try {
    return localStorage.getItem(TZ_KEY) || null;
  } catch {
    return null;
  }
}

type Parts = Record<string, string>;

function partsInTz(d: Date, tz: string, withSeconds: boolean): Parts {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' as const } : {}),
    hour12: false
  })
    .formatToParts(d)
    .reduce<Parts>((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});
}

/** Current wall-clock time at the course (falls back to browser time until the zone is known). */
export function courseNow(): Date {
  const real = new Date();
  const tz = courseTz();
  if (!tz) return real;
  try {
    const p = partsInTz(real, tz, true);
    const shifted = new Date(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour) % 24, // some engines render midnight as "24"
      Number(p.minute),
      Number(p.second),
      real.getMilliseconds()
    );
    return isNaN(shifted.getTime()) ? real : shifted;
  } catch {
    return real;
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Today at the course as 'YYYY-MM-DD'. */
export function courseToday(): string {
  const d = courseNow();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Current course hour as 'YYYY-MM-DDTHH' — same shape as the start of Open-Meteo hourly.time entries. */
export function courseHourKey(): string {
  const d = courseNow();
  return `${courseToday()}T${pad(d.getHours())}`;
}

/** Render a stored instant (ISO string, epoch ms, Date, or {seconds,nanoseconds}) in course time. */
export function formatInCourseTz(value: unknown): string {
  let d: Date;
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    d = (value as { toDate: () => Date }).toDate();
  } else if (value && typeof (value as { seconds?: unknown }).seconds === 'number') {
    const v = value as { seconds: number; nanoseconds?: number };
    d = new Date(v.seconds * 1000 + Math.round((v.nanoseconds || 0) / 1e6));
  } else {
    d = new Date(value as string | number | Date);
  }
  if (isNaN(d.getTime())) return '';

  let dd = pad(d.getDate());
  let mm = pad(d.getMonth() + 1);
  let yyyy = String(d.getFullYear());
  let hours = d.getHours();
  let minutes = pad(d.getMinutes());

  const tz = courseTz();
  if (tz) {
    try {
      const p = partsInTz(d, tz, false);
      const h = Number(p.hour) % 24;
      if (!isNaN(h)) {
        dd = p.day;
        mm = p.month;
        yyyy = p.year;
        hours = h;
        minutes = p.minute;
      }
    } catch {
      /* zone unknown to this browser -> browser time */
    }
  }

  const ampm = hours >= 12 ? 'PM' : 'AM';
  return `${dd}/${mm}/${yyyy}, ${hours % 12 || 12}:${minutes} ${ampm}`;
}
