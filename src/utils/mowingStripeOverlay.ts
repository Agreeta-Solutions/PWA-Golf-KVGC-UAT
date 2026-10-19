import type { LatLng } from '../types/hole';
import { angleDegrees } from './mowingPatternResolver';

export interface LatLngBounds {
  southwest: LatLng;
  northeast: LatLng;
}

/** Real-world width of one dark + light stripe pair, identical on every section. */
const STRIPE_PAIR_METERS = 3.0;

// Stripe tile from the design SVGs in assets/mowing_directions/: 51 units, 25 dark + 26 light.
const TILE_UNITS = 51;
const DARK_UNITS = 25;
const STRIPE_DARK = '#46923A';
const STRIPE_LIGHT = '#77C64A';

const MAX_OVERLAY_SIDE_PX = 1536;
const METERS_PER_DEGREE_LAT = 110574.0;
const METERS_PER_DEGREE_LNG_AT_EQUATOR = 111320.0;

/**
 * Pixel/metre geometry of an overlay bitmap that covers [LatLngBounds] at its real-world aspect ratio
 * (north up), so shapes drawn in metres keep their proportions on the map.
 */
export class SectionOverlayGeometry {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  latSpan: number;
  lngSpan: number;
  metersPerDegreeLng: number;
  isValid: boolean;
  widthMeters: number;
  heightMeters: number;
  widthPx: number;
  heightPx: number;
  pixelsPerMeter: number;

  constructor(bounds: LatLngBounds) {
    this.minLat = bounds.southwest.lat;
    this.maxLat = bounds.northeast.lat;
    this.minLng = bounds.southwest.lng;
    this.maxLng = bounds.northeast.lng;
    this.latSpan = this.maxLat - this.minLat;
    this.lngSpan = this.maxLng - this.minLng;
    this.metersPerDegreeLng =
      METERS_PER_DEGREE_LNG_AT_EQUATOR * Math.cos(((this.minLat + this.maxLat) / 2) * (Math.PI / 180));

    this.isValid = this.latSpan > 0 && this.lngSpan > 0;
    this.widthMeters = this.lngSpan * this.metersPerDegreeLng;
    this.heightMeters = this.latSpan * METERS_PER_DEGREE_LAT;

    if (!this.isValid) {
      this.widthPx = 1;
      this.heightPx = 1;
    } else if (this.widthMeters >= this.heightMeters) {
      this.widthPx = MAX_OVERLAY_SIDE_PX;
      this.heightPx = Math.max(1, Math.round((MAX_OVERLAY_SIDE_PX * this.heightMeters) / this.widthMeters));
    } else {
      this.widthPx = Math.max(1, Math.round((MAX_OVERLAY_SIDE_PX * this.widthMeters) / this.heightMeters));
      this.heightPx = MAX_OVERLAY_SIDE_PX;
    }
    this.pixelsPerMeter = this.widthMeters > 0 ? this.widthPx / this.widthMeters : 1;
  }

  xPx(lng: number): number {
    return ((lng - this.minLng) / this.lngSpan) * this.widthPx;
  }

  yPx(lat: number): number {
    return ((this.maxLat - lat) / this.latSpan) * this.heightPx;
  }
}

/**
 * Computes bounding box for a polygon.
 */
export function computePolygonBounds(points: LatLng[]): LatLngBounds {
  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;

  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  return {
    southwest: { lat: minLat, lng: minLng },
    northeast: { lat: maxLat, lng: maxLng }
  };
}

/**
 * Draws the mowing stripe pattern for [stripeAxes] (see [MowingPatternResolver]) into a canvas
 * covering [bounds], clipped to the KML boundary [polygonPoints], for use as a GroundOverlay.
 */
export function createMowingStripeOverlay(
  stripeAxes: number[],
  polygonPoints: LatLng[],
  bounds: LatLngBounds,
  anchor?: LatLng
): string | null {
  if (stripeAxes.length === 0 || polygonPoints.length < 3) return null;

  const geometry = new SectionOverlayGeometry(bounds);
  if (!geometry.isValid) return null;

  const canvas = document.createElement('canvas');
  canvas.width = geometry.widthPx;
  canvas.height = geometry.heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Clip strictly to the section's KML polygon outline
  ctx.save();
  ctx.beginPath();
  polygonPoints.forEach((pt, i) => {
    const x = geometry.xPx(pt.lng);
    const y = geometry.yPx(pt.lat);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.clip();

  // Draw stripe layers
  const pairWidthPx = Math.max(2, STRIPE_PAIR_METERS * geometry.pixelsPerMeter);
  const darkWidthPx = (DARK_UNITS / TILE_UNITS) * pairWidthPx;
  const lightWidthPx = ((TILE_UNITS - DARK_UNITS) / TILE_UNITS) * pairWidthPx;
  const diagonal = Math.hypot(geometry.widthPx, geometry.heightPx);

  stripeAxes.forEach((axis, index) => {
    ctx.save();
    // First layer is 100% opacity, subsequent layers at 50% opacity
    ctx.globalAlpha = index === 0 ? 1.0 : 0.5;

    // Rotate by the stripe axis angle (clockwise from North) around a pivot. When a hole-wide
    // [anchor] is given, every section uses the same geographic pivot, so stripes line up across
    // neighbouring / overlapping sections (e.g. Tee1 + Tee2) instead of mixing into a blur.
    const angleDeg = angleDegrees(axis);
    const rad = (angleDeg * Math.PI) / 180;
    const cx = anchor ? geometry.xPx(anchor.lng) : geometry.widthPx / 2;
    const cy = anchor ? geometry.yPx(anchor.lat) : geometry.heightPx / 2;

    ctx.translate(cx, cy);
    ctx.rotate(rad);
    ctx.translate(-cx, -cy);

    // Draw stripes around the pivot, far enough to cover the whole (rotated) canvas
    const radius = Math.max(
      Math.hypot(cx, cy),
      Math.hypot(geometry.widthPx - cx, cy),
      Math.hypot(cx, geometry.heightPx - cy),
      Math.hypot(geometry.widthPx - cx, geometry.heightPx - cy),
      diagonal
    );
    const startX = cx - Math.ceil(radius / pairWidthPx) * pairWidthPx;
    const endX = cx + radius + pairWidthPx;
    const startY = cy - radius;
    const stripeHeight = radius * 2;

    for (let x = startX; x < endX; x += pairWidthPx) {
      // Dark green stripe (#46923A)
      ctx.fillStyle = STRIPE_DARK;
      ctx.fillRect(x, startY, darkWidthPx, stripeHeight);

      // Light green stripe (#77C64A)
      ctx.fillStyle = STRIPE_LIGHT;
      ctx.fillRect(x + darkWidthPx, startY, lightWidthPx, stripeHeight);
    }

    ctx.restore();
  });

  ctx.restore();

  return canvas.toDataURL('image/png');
}

/**
 * Solid fill for a section without mowing stripes, clipped to its KML boundary, drawn as a
 * GroundOverlay so it stacks *under* striped sections (map polygons always draw above
 * GroundOverlays and would hide the stripes of sections they overlap).
 */
export function createSolidSectionOverlay(
  polygonPoints: LatLng[],
  bounds: LatLngBounds,
  color: string,
  alpha: number
): string | null {
  if (polygonPoints.length < 3) return null;

  const geometry = new SectionOverlayGeometry(bounds);
  if (!geometry.isValid) return null;

  // A flat colour needs far fewer pixels than stripes
  const scale = Math.min(1, 512 / Math.max(geometry.widthPx, geometry.heightPx));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(geometry.widthPx * scale));
  canvas.height = Math.max(1, Math.round(geometry.heightPx * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  polygonPoints.forEach((pt, i) => {
    const x = geometry.xPx(pt.lng) * scale;
    const y = geometry.yPx(pt.lat) * scale;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fill();

  return canvas.toDataURL('image/png');
}
