export interface HoleIdOption {
  id: number;
  holeName: string;
}

export interface GolfSectionOption {
  id: number;
  description: string;
}

export interface KmlData {
  kmlId: number;
  areaId: number;
  kmlFileName: string;
  kmlUrl: string;
}

export interface HoleAreaItem {
  holeId: number;
  holeDescription: string;
  sectionId: number;
  sectionDescription: string;
  kmlData?: KmlData;
}

export interface HoleAreaResponse {
  status: number;
  message: string;
  data: HoleAreaItem[];
}

export type HoleViewLayer = 'SATELLITE' | 'MOISTURE' | 'VEG_STRESS' | 'LANDSCAPE';

export interface MowingDirectionDetail {
  /** Mowing entry id: one per save from the dashboard (both directions of a double cut share it). Higher = newer. */
  id?: number;
  /** Id of this individual direction within the entry. */
  mowingDetailId?: number;
  mowingDate: string;
  hole: string;
  section: string;
  mowingType: string;
  mowingDirection: string;
}

export interface MowingResponse {
  status: number;
  message: string;
  data?: {
    mowingDirectionDetails?: MowingDirectionDetail[];
  };
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface SatelliteDateItem {
  date: string;
}

export interface SatelliteDatesResponse {
  status: number;
  message: string;
  data?: {
    'satellite Dates'?: SatelliteDateItem[];
  };
}

export interface SatelliteGridItem {
  hole_id?: number;
  section_id?: number;
  date?: string;
  latitude: number;
  longitude: number;
  colour_code?: string;
  colour_id?: number;
}

export interface SatelliteGridResponse {
  status: number;
  message: string;
  data?: {
    'satellite Analysis Details'?: SatelliteGridItem[];
    'satellite Dates'?: SatelliteGridItem[];
  };
}

export interface ReferenceDataSection {
  id: number;
  categoryId: number;
  description: string;
  parentId?: number;
  parentDescription?: string;
}

export interface ReferenceDataAnalysis {
  id: number;
  categoryId: number;
  description: string;
}

export interface ReferenceDataHole {
  id: number;
  name: string;
}

export interface ReferenceDataResponse {
  status: number;
  message: string;
  data?: {
    section?: ReferenceDataSection[];
    'satellite Analysis'?: ReferenceDataAnalysis[];
    holes?: ReferenceDataHole[];
  };
}

export interface GridSquare {
  bounds: LatLng[];
  center: LatLng;
  color: string;
}
