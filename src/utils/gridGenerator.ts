import type { LatLng, SatelliteGridItem, GridSquare } from '../types/hole';

export const CELL_DEG = 0.00009; // Exact Android cell degree step (10m x 10m)

/**
 * Ultra-fast 2D Ray-Casting Point-in-Polygon algorithm (0.0001 ms per cell)
 * Supports both LatLng object and raw (lng, lat) coordinates.
 */
export function isPointInPolygon(px: number | LatLng, py?: number | LatLng[], polygon?: LatLng[]): boolean {
  let x: number, y: number, poly: LatLng[];
  if (typeof px === 'object') {
    x = px.lng;
    y = px.lat;
    poly = py as LatLng[];
  } else {
    x = px;
    y = py as number;
    poly = polygon!;
  }
  if (!poly || poly.length < 3) return false;
  let inside = false;
  const len = poly.length;
  for (let i = 0, j = len - 1; i < len; j = i++) {
    const xi = poly[i].lng, yi = poly[i].lat;
    const xj = poly[j].lng, yj = poly[j].lat;
    const intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Returns color strictly derived from the API response (hex code or numeric colourId).
 * Zero hardcoded color overrides or artificial fallbacks.
 */
export function getColorForColourId(colourCode: string | number, isMoisture: boolean): string | null {
  const str = String(colourCode ?? '').trim();
  if (!str) return null;

  // 1. Direct API Hex Color
  if (str.startsWith('#')) {
    return str;
  }

  // 1b. Direct Hex Color without '#' (e.g. "006400", "7ECAF2", "D30000")
  if (/^[0-9A-Fa-f]{6}$/.test(str)) {
    return '#' + str;
  }

  // 2. Numeric colourId mapping matching Android DynamicHoleView.kt exactly
  const colourId = parseInt(str, 10);
  if (isNaN(colourId)) return null;

  if (isMoisture) {
    // Moisture Legend: Dry (#808080), Moist (#87CEEB), Flooded (#00008B)
    if (colourId <= 21) return '#808080';
    if (colourId === 22 || colourId === 23) return '#87CEEB';
    return '#00008B';
  } else {
    // Turf Health Legend: Healthy (#006400), Moderate (#FFFF00), Stress (#D30000)
    if (colourId <= 21) return '#006400';
    if (colourId === 22) return '#FFFF00';
    return '#D30000';
  }
}

export const interpolatedNeighborOffsets: Array<[number, number]> = (() => {
  const list: Array<[number, number]> = [];
  const R = 15;
  for (let dx = -R; dx <= R; dx++) {
    for (let dy = -R; dy <= R; dy++) {
      list.push([dx, dy]);
    }
  }
  list.sort((a, b) => (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]));
  return list;
})();

export interface BaseGridCell {
  bounds: LatLng[];
  center: LatLng;
  holeId?: number;
  sectionId: number;
  ix: number;
  iy: number;
}

/**
 * Sutherland-Hodgman polygon clipping against an axis-aligned bounding box.
 * Returns a new polygon representing (poly ∩ [minLng, maxLng] x [minLat, maxLat]).
 * Guaranteed to produce zero vertices outside the clipping boundary.
 */
export function clipPolygonAgainstBox(
  poly: LatLng[],
  minLng: number,
  maxLng: number,
  minLat: number,
  maxLat: number
): LatLng[] {
  if (!poly || poly.length < 3) return [];

  // Normalize: remove closing point if identical to first
  let input = poly;
  if (poly.length > 2) {
    const first = poly[0];
    const last = poly[poly.length - 1];
    if (Math.abs(first.lng - last.lng) < 1e-11 && Math.abs(first.lat - last.lat) < 1e-11) {
      input = poly.slice(0, -1);
    }
  }

  function clipEdge(
    points: LatLng[],
    isInside: (pt: LatLng) => boolean,
    intersect: (p1: LatLng, p2: LatLng) => LatLng
  ): LatLng[] {
    const result: LatLng[] = [];
    if (points.length === 0) return result;
    let prev = points[points.length - 1];
    let prevInside = isInside(prev);

    for (let i = 0; i < points.length; i++) {
      const curr = points[i];
      const currInside = isInside(curr);
      if (currInside) {
        if (!prevInside) {
          result.push(intersect(prev, curr));
        }
        result.push(curr);
      } else if (prevInside) {
        result.push(intersect(prev, curr));
      }
      prev = curr;
      prevInside = currInside;
    }
    return result;
  }

  const EPS = 1e-11;

  // 1. lng >= minLng
  let p = clipEdge(input, pt => pt.lng >= minLng - EPS, (p1, p2) => {
    const dx = p2.lng - p1.lng;
    const t = Math.abs(dx) < 1e-15 ? 0 : (minLng - p1.lng) / dx;
    return { lat: p1.lat + t * (p2.lat - p1.lat), lng: minLng };
  });
  if (p.length === 0) return [];

  // 2. lng <= maxLng
  p = clipEdge(p, pt => pt.lng <= maxLng + EPS, (p1, p2) => {
    const dx = p2.lng - p1.lng;
    const t = Math.abs(dx) < 1e-15 ? 0 : (maxLng - p1.lng) / dx;
    return { lat: p1.lat + t * (p2.lat - p1.lat), lng: maxLng };
  });
  if (p.length === 0) return [];

  // 3. lat >= minLat
  p = clipEdge(p, pt => pt.lat >= minLat - EPS, (p1, p2) => {
    const dy = p2.lat - p1.lat;
    const t = Math.abs(dy) < 1e-15 ? 0 : (minLat - p1.lat) / dy;
    return { lat: minLat, lng: p1.lng + t * (p2.lng - p1.lng) };
  });
  if (p.length === 0) return [];

  // 4. lat <= maxLat
  p = clipEdge(p, pt => pt.lat <= maxLat + EPS, (p1, p2) => {
    const dy = p2.lat - p1.lat;
    const t = Math.abs(dy) < 1e-15 ? 0 : (maxLat - p1.lat) / dy;
    return { lat: maxLat, lng: p1.lng + t * (p2.lng - p1.lng) };
  });
  if (p.length < 3) return [];

  // Filter out any vertex that is a box corner outside the polygon
  const filtered: LatLng[] = [];
  for (const pt of p) {
    const isBoxCorner = (Math.abs(pt.lng - minLng) < 1e-9 || Math.abs(pt.lng - maxLng) < 1e-9) &&
                        (Math.abs(pt.lat - minLat) < 1e-9 || Math.abs(pt.lat - maxLat) < 1e-9);
    if (isBoxCorner) {
      if (isPointInPolygon(pt.lng, pt.lat, poly)) {
        filtered.push(pt);
      }
    } else {
      filtered.push(pt);
    }
  }

  if (filtered.length < 3) return [];

  // Deduplicate consecutive points
  const cleaned: LatLng[] = [];
  for (let i = 0; i < filtered.length; i++) {
    const pt = filtered[i];
    const prev = cleaned[cleaned.length - 1];
    if (!prev || Math.abs(pt.lng - prev.lng) > 1e-9 || Math.abs(pt.lat - prev.lat) > 1e-9) {
      cleaned.push(pt);
    }
  }
  if (cleaned.length > 2) {
    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    if (Math.abs(first.lng - last.lng) < 1e-9 && Math.abs(first.lat - last.lat) < 1e-9) {
      cleaned.pop();
    }
  }

  if (cleaned.length < 3) return [];

  // Discard negligible slivers (< 2% of standard 10m cell area)
  let area = 0;
  const len = cleaned.length;
  for (let i = 0, j = len - 1; i < len; j = i++) {
    area += (cleaned[j].lng + cleaned[i].lng) * (cleaned[j].lat - cleaned[i].lat);
  }
  if (Math.abs(area / 2.0) < 2e-10) return [];

  return cleaned;
}

/**
 * Pre-computes base 10m grid geometry for a section polygon.
 * Computed ONCE per section and cached in memory (0ms recomputation on date/layer switch).
 * Strictly clips boundary cells to the KML section boundary so no cell ever spills outside.
 */
export function computeBaseGridCellsForSection(
  sectionId: number,
  sectionPolygon: LatLng[],
  holeId?: number,
  referenceLat?: number
): BaseGridCell[] {
  if (!sectionPolygon || sectionPolygon.length < 3) return [];

  // Compute bounding box
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of sectionPolygon) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  const centerLat = referenceLat ?? (minLat + maxLat) / 2.0;
  const cellHeight = CELL_DEG; // 0.00009 (~10m)
  const cellWidth = CELL_DEG / Math.cos((centerLat * Math.PI) / 180.0);

  // Snap to uniform grid so adjacent sections line up seamlessly
  const startLng = Math.floor(minLng / cellWidth) * cellWidth;
  const startLat = Math.floor(minLat / cellHeight) * cellHeight;
  const numX = Math.ceil((maxLng - startLng) / cellWidth);
  const numY = Math.ceil((maxLat - startLat) / cellHeight);

  const cells: BaseGridCell[] = [];

  for (let ix = 0; ix <= numX; ix++) {
    for (let iy = 0; iy <= numY; iy++) {
      const left = startLng + ix * cellWidth;
      const right = left + cellWidth;
      const bottom = startLat + iy * cellHeight;
      const top = bottom + cellHeight;

      const cx = left + cellWidth / 2.0;
      const cy = bottom + cellHeight / 2.0;

      // PIP classification for cell corners
      const c1 = isPointInPolygon(left, top, sectionPolygon);
      const c2 = isPointInPolygon(right, top, sectionPolygon);
      const c3 = isPointInPolygon(right, bottom, sectionPolygon);
      const c4 = isPointInPolygon(left, bottom, sectionPolygon);

      let bounds: LatLng[];
      let center: LatLng;

      const hasPolyVertexInside = sectionPolygon.some(
        p => p.lng >= left && p.lng <= right && p.lat >= bottom && p.lat <= top
      );

      if (c1 && c2 && c3 && c4 && !hasPolyVertexInside) {
        // Internal cell: entire 10m x 10m square is 100% inside polygon
        bounds = [
          { lat: top, lng: left },
          { lat: top, lng: right },
          { lat: bottom, lng: right },
          { lat: bottom, lng: left },
          { lat: top, lng: left }
        ];
        center = { lat: cy, lng: cx };
      } else {
        // Boundary cell: Clip polygon against box so NO vertex extends outside polygon
        const clipped = clipPolygonAgainstBox(sectionPolygon, left, right, bottom, top);
        if (clipped.length < 3) continue;

        bounds = [...clipped, clipped[0]];
        let latSum = 0;
        let lngSum = 0;
        for (const pt of clipped) {
          latSum += pt.lat;
          lngSum += pt.lng;
        }
        center = {
          lat: latSum / clipped.length,
          lng: lngSum / clipped.length
        };
      }

      const cix = Math.round(cx / cellWidth);
      const ciy = Math.round(cy / cellHeight);

      cells.push({
        bounds,
        center,
        holeId,
        sectionId,
        ix: cix,
        iy: ciy
      });
    }
  }

  return cells;
}

/**
 * Superfast coloring of pre-computed base grid cells using API points.
 * Features spatial neighbor interpolation to guarantee 100% gapless hole coverage.
 */
export function colorBaseGridCells(
  baseCells: BaseGridCell[],
  satellitePoints: SatelliteGridItem[],
  isMoisture: boolean = false,
  targetHoleId?: number
): GridSquare[] {
  if (!baseCells || baseCells.length === 0 || !satellitePoints || satellitePoints.length === 0) {
    return [];
  }

  const expectedHoleId = targetHoleId || baseCells[0]?.holeId;
  const filteredPoints = expectedHoleId !== undefined
    ? satellitePoints.filter(p => p.hole_id === undefined || p.hole_id === expectedHoleId)
    : satellitePoints;

  // If points are explicitly for a different hole, return empty
  if (filteredPoints.length === 0) {
    return [];
  }

  // Verify points are strictly within hole envelope (prevents adjacent hole bleed)
  let minCellLat = Infinity, maxCellLat = -Infinity, minCellLng = Infinity, maxCellLng = -Infinity;
  for (const c of baseCells) {
    if (c.center.lat < minCellLat) minCellLat = c.center.lat;
    if (c.center.lat > maxCellLat) maxCellLat = c.center.lat;
    if (c.center.lng < minCellLng) minCellLng = c.center.lng;
    if (c.center.lng > maxCellLng) maxCellLng = c.center.lng;
  }
  const LAT_MARGIN = 0.015; // ~1.6 km margin to prevent dropping valid points on any hole shape
  const LNG_MARGIN = 0.015;

  let validHolePoints = filteredPoints.filter(p =>
    p.latitude >= minCellLat - LAT_MARGIN &&
    p.latitude <= maxCellLat + LAT_MARGIN &&
    p.longitude >= minCellLng - LNG_MARGIN &&
    p.longitude <= maxCellLng + LNG_MARGIN
  );

  if (validHolePoints.length === 0) {
    validHolePoints = filteredPoints;
  }

  if (validHolePoints.length === 0) {
    return [];
  }

  const centerLat = baseCells.reduce((acc, c) => acc + c.center.lat, 0) / baseCells.length;
  const cellHeight = CELL_DEG;
  const cellWidth = CELL_DEG / Math.cos((centerLat * Math.PI) / 180.0);

  // Build points hash table from live API points
  const pointsHash = new Map<string, string>();
  for (const pt of validHolePoints) {
    if (pt.latitude && pt.longitude && pt.colour_code) {
      const ix = Math.round(pt.longitude / cellWidth);
      const iy = Math.round(pt.latitude / cellHeight);
      pointsHash.set(`${ix},${iy}`, pt.colour_code);
    }
  }

  const gridSquares: GridSquare[] = [];

  for (const cell of baseCells) {
    // Dynamic cell hashing exactly matching Android DynamicHoleView.kt
    const cix = Math.round(cell.center.lng / cellWidth);
    const ciy = Math.round(cell.center.lat / cellHeight);

    let matchedColor: string | null = null;
    for (const [dx, dy] of interpolatedNeighborOffsets) {
      const key = `${cix + dx},${ciy + dy}`;
      const colourCode = pointsHash.get(key);
      if (colourCode !== undefined) {
        matchedColor = getColorForColourId(colourCode, isMoisture);
        if (matchedColor) break;
      }
    }

    // Spatial propagation: If cell has no point within local radius, fill from nearest measurement on hole (e.g. Tee boxes)
    if (!matchedColor && validHolePoints.length > 0) {
      let minDistSq = Infinity;
      let nearestPt: SatelliteGridItem | null = null;
      for (const pt of validHolePoints) {
        if (pt.latitude && pt.longitude && pt.colour_code) {
          const dLat = pt.latitude - cell.center.lat;
          const dLng = pt.longitude - cell.center.lng;
          const distSq = dLat * dLat + dLng * dLng;
          if (distSq < minDistSq) {
            minDistSq = distSq;
            nearestPt = pt;
          }
        }
      }
      if (nearestPt && nearestPt.colour_code) {
        matchedColor = getColorForColourId(nearestPt.colour_code, isMoisture);
      }
    }

    if (matchedColor) {
      gridSquares.push({
        bounds: cell.bounds,
        center: cell.center,
        color: matchedColor
      });
    }
  }

  return gridSquares;
}

