import type { MowingDirectionDetail } from '../types/hole';

/**
 * Maps `api/Mowing` rows to the stripe layers to draw per section.
 * A tee section without usable data copies another tee on the hole that has data (Tee1 first);
 * if no tee has any, or for any other section without data, nothing is drawn.
 *
 * Directions are clock positions ("5 to 11"). Opposite positions describe the same stripe line,
 * so each direction collapses to an axis 1..6 (1-7, 2-8, 3-9, 4-10, 5-11, 6-12).
 * - Single cut: one layer.
 * - Double cut: two layers; the second is drawn at half opacity. For the pairs that have a design
 *   file (6+3, 4+1, 5+2) the full-opacity layer is the one with the smaller angle.
 */

const designedDoublePairs = new Set([
  '3,6', '6,3',
  '1,4', '4,1',
  '2,5', '5,2'
]);

/**
 * "5 to 11", "11-5", "12 to 6" -> axis 1..6; null when the text isn't two opposite clock positions.
 */
export function axisOf(direction?: string | null): number | null {
  if (!direction) return null;
  const positions = (direction.match(/\d+/g) || []).map(Number);
  if (positions.length !== 2) return null;
  const [a, b] = positions;
  if (a < 1 || a > 12 || b < 1 || b > 12) return null;
  if ((a - b + 12) % 12 !== 6) return null;
  return ((Math.min(a, b) - 1) % 6) + 1;
}

/**
 * Parses all stripe axes from a direction string (supports multiple pairs like "3-9 and 6-12" or "3-9, 6-12").
 */
export function extractAxesFromDirection(direction?: string | null): number[] {
  if (!direction) return [];
  const digits = (direction.match(/\d+/g) || []).map(Number);
  if (digits.length === 2) {
    const ax = axisOf(direction);
    return ax !== null ? [ax] : [];
  }
  const axes: number[] = [];
  for (let i = 0; i < digits.length - 1; i += 2) {
    const a = digits[i];
    const b = digits[i + 1];
    if (a >= 1 && a <= 12 && b >= 1 && b <= 12 && (a - b + 12) % 12 === 6) {
      const ax = ((Math.min(a, b) - 1) % 6) + 1;
      if (!axes.includes(ax)) {
        axes.push(ax);
      }
    }
  }
  return axes;
}

/**
 * Clockwise rotation from north of the stripes for [axis] (12-6 = 0°, 1-7 = 30°, ... 5-11 = 150°).
 */
export function angleDegrees(axis: number): number {
  return (axis % 6) * 30;
}

/**
 * Stripe axes in draw order (first = full opacity, rest = half), or empty if nothing parses.
 */
export function resolveLayers(details: MowingDirectionDetail[]): number[] {
  const axes: number[] = [];
  for (const d of details) {
    const parsed = extractAxesFromDirection(d.mowingDirection);
    for (const ax of parsed) {
      if (!axes.includes(ax)) {
        axes.push(ax);
      }
    }
  }
  if (axes.length === 0) return [];

  const isDouble = details.some(d => (d.mowingType || '').toLowerCase().includes('double')) || axes.length >= 2;
  if (isDouble && axes.length === 1) {
    const companion = ((axes[0] - 1 + 3) % 6) + 1;
    axes.push(companion);
  }
  if (!isDouble || axes.length < 2) return axes.slice(0, 1);

  const pair = axes.slice(0, 2);
  const pairKey1 = `${pair[0]},${pair[1]}`;
  const pairKey2 = `${pair[1]},${pair[0]}`;
  if (designedDoublePairs.has(pairKey1) || designedDoublePairs.has(pairKey2)) {
    return [...pair].sort((x, y) => angleDegrees(x) - angleDegrees(y));
  }
  return pair;
}

export interface SectionMowingInput {
  sectionId: number;
  description?: string;
  details?: MowingDirectionDetail[];
}

/**
 * Keeps only the newest mowing entry: the records with the highest `id`.
 * Each save from the dashboard creates a new entry (id) and older entries stay in the API
 * response; both directions of a double cut share one id. Records are returned unchanged when
 * none carries an id.
 */
export function latestEntryOnly<T extends { id?: number }>(details: T[]): T[] {
  const ids = details
    .map(d => d.id)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (ids.length === 0) return details;
  const maxId = Math.max(...ids);
  return details.filter(d => d.id === maxId);
}

/**
 * Applies [latestEntryOnly] separately for each section, so a response that covers several
 * sections keeps the newest entry of every section.
 */
export function latestEntryPerSection<T extends { id?: number; section?: string }>(details: T[]): T[] {
  const bySection = new Map<string, T[]>();
  for (const d of details) {
    const key = (d.section || '').trim().toLowerCase();
    const list = bySection.get(key) || [];
    list.push(d);
    bySection.set(key, list);
  }
  return Array.from(bySection.values()).flatMap(list => latestEntryOnly(list));
}
