import type { LatLng } from '../types/hole';
import { logSafeError } from './logger';

/**
 * Parses KML XML text and extracts list of LatLng coordinates for polygon rendering.
 */
export function parseKMLCoordinates(kmlText: string): LatLng[] {
  try {
    let rawCoords = '';

    // 1. Try DOMParser (supporting namespace wildcards)
    if (typeof DOMParser !== 'undefined') {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(kmlText, 'text/xml');
      
      const coordNodes = xmlDoc.getElementsByTagNameNS('*', 'coordinates');
      if (coordNodes && coordNodes.length > 0) {
        rawCoords = coordNodes[0].textContent || '';
      } else {
        const plainNodes = xmlDoc.getElementsByTagName('coordinates');
        if (plainNodes && plainNodes.length > 0) {
          rawCoords = plainNodes[0].textContent || '';
        }
      }
    }

    // 2. Regex fallback for namespace prefixes like <ns0:coordinates> or <coordinates>
    if (!rawCoords) {
      const match = kmlText.match(/<(?:\w+:)?coordinates>([\s\S]*?)<\/(?:\w+:)?coordinates>/i);
      if (match) {
        rawCoords = match[1];
      }
    }

    if (!rawCoords) {
      return [];
    }

    const points: LatLng[] = [];
    const rawTokens = rawCoords.trim().split(/\s+/);
    for (const token of rawTokens) {
      if (!token) continue;
      const parts = token.split(',');
      if (parts.length >= 2) {
        const lng = parseFloat(parts[0]);
        const lat = parseFloat(parts[1]);
        if (!isNaN(lat) && !isNaN(lng)) {
          points.push({ lat, lng });
        }
      }
    }

    return points;
  } catch (err) {
    logSafeError('parseKMLCoordinates', err);
    return [];
  }
}
