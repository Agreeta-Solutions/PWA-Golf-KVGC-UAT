import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { GoogleMap, useJsApiLoader, MarkerF, OverlayViewF, OverlayView } from '@react-google-maps/api';
import type { HoleViewLayer, LatLng, SatelliteGridItem, MowingDirectionDetail } from '../types/hole';
import type { HomeTaskUi } from '../types/task';
import { 
  fetchHoleAreaPolygons, 
  getCachedHoleAreaPolygons,
  fetchSatelliteDates, 
  getCachedSatelliteDates,
  fetchSatelliteGridData, 
  getCachedSatelliteGridData,
  fetchReferenceData, 
  getCachedReferenceData, 
  prefetchAdjacentHole, 
  clearL1GridCache, 
  fetchMowingDirectionsSectionWise, 
  getCachedMowingDirections,
  getCachedHoleSections, 
  fetchHoleSections 
} from '../services/apiService';
import { computeBaseGridCellsForSection, colorBaseGridCells } from '../utils/gridGenerator';
import type { BaseGridCell } from '../utils/gridGenerator';
import { logSafeError } from '../utils/logger';
import { ChevronDown, ChevronUp, Layers, Crosshair, Calendar } from 'lucide-react';
import { resolveLayers, latestEntryOnly } from '../utils/mowingPatternResolver';
import { createMowingStripeOverlay, createSolidSectionOverlay, computePolygonBounds } from '../utils/mowingStripeOverlay';
import { getActiveCourseInfo } from '../services/weatherService';
import { AndroidDatePickerDialog } from '../components/AndroidDatePickerDialog';

const holeBaseCellsCache = new Map<string, BaseGridCell[]>();

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

interface HoleViewScreenProps {
  tasks: HomeTaskUi[];
  completingTaskId?: string | null;
  onMarkTaskDone?: (task: HomeTaskUi) => void;
  initialHoleId?: number;
  initialSectionId?: number | null;
  initialTaskId?: string | null;
  onNavigateToHomeTask?: (taskId: string) => void;
  onHoleChange?: (holeId: number, sectionId: number | null) => void;
}

const mapContainerStyle = {
  width: '100%',
  height: '100%'
};

// Map center used until the hole's KML outlines load: the active course's coordinates
// (RACV Healesville Country Club by default, Kharghar / Dirab when connected to those APIs).
function getDefaultCenter(): LatLng {
  const course = getActiveCourseInfo();
  return { lat: course.latitude, lng: course.longitude };
}

// Global Module-Level In-Memory KML Polygon Cache for 0ms instant hole toggling
const kmlCacheMap = new Map<number, Map<number, LatLng[]>>();

export interface UiSection {
  description: string;
  sectionIds: number[];
}

/**
 * Resolves the canonical parent category for any golf course section description.
 * Normalizes all variations (e.g. "Tee 1", "Tee I", "Tee-2", "Fairway 1", "Approach 1", "Green 1")
 * into their canonical parent category ("Tee", "Fairway", "Approach", "Green", "Rough").
 */
export function getCanonicalParentCategory(rawName?: string | null): string {
  if (!rawName) return '';
  const s = rawName.trim().toLowerCase();
  if (s.includes('approach')) return 'Approach';
  if (s.includes('fairway')) return 'Fairway';
  if (s.includes('tee')) return 'Tee';
  if (s.includes('green')) return 'Green';
  if (s.includes('rough')) return 'Rough';
  const cleaned = s
    .replace(/[\d]+.*$/, '')
    .replace(/[\s\-_]+[ivx]+$/i, '')
    .trim();
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase() : rawName.trim();
}

export const HoleViewScreen: React.FC<HoleViewScreenProps> = ({
  tasks,
  initialHoleId,
  initialSectionId,
  initialTaskId,
  onNavigateToHomeTask,
  onHoleChange
}) => {
  // Dynamic Reference Data options strictly from API / cache
  const [rawSections, setRawSections] = useState<Array<{ id: number; description: string }>>(() => {
    const cached = getCachedReferenceData();
    if (cached?.section && cached.section.length > 0) {
      return cached.section.map(s => ({ id: s.id, description: s.description }));
    }
    return [];
  });
  const [holeOptions, setHoleOptions] = useState<Array<{ id: number; name: string }>>(() => {
    const cached = getCachedReferenceData();
    if (cached?.holes && cached.holes.length > 0) {
      return cached.holes
        .filter(h => {
          const name = (h.name || '').toLowerCase();
          return !name.includes('practice') && !name.includes('driving') && !name.includes('all hole');
        })
        .map(h => ({ id: h.id, name: h.name }));
    }
    return [];
  });

  const [selectedHoleId, setSelectedHoleId] = useState<number>(() => {
    if (initialHoleId) return initialHoleId;
    const cached = getCachedReferenceData();
    if (cached?.holes && cached.holes.length > 0) {
      const firstValid = cached.holes.find(h => {
        const name = (h.name || '').toLowerCase();
        return !name.includes('practice') && !name.includes('driving') && !name.includes('all hole');
      });
      if (firstValid?.id != null) return firstValid.id;
    }
    return 1;
  });

  const [selectedSectionName, setSelectedSectionName] = useState<string | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<number | null>(initialSectionId ?? null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTaskId ?? null);
  // Default Task View active matching Android DynamicHoleView.kt line 312
  const [isTaskViewActive, setIsTaskViewActive] = useState<boolean>(true);
  const initialMapCenterRef = useRef<LatLng>(getDefaultCenter());

  useEffect(() => {
    if (initialHoleId && initialHoleId !== selectedHoleId) {
      setSelectedHoleId(initialHoleId);
      setSelectedSectionName(null);
      setSelectedDate('');
      setSatelliteDates([]);
      setGridData([]);
      const cached = getCachedHoleAreaPolygons(initialHoleId) || kmlCacheMap.get(initialHoleId);
      setKmlPolygons(cached || new Map());
      lastFittedKeyRef.current = null;
    }
    if (initialSectionId !== undefined && initialSectionId !== selectedSectionId) {
      setSelectedSectionId(initialSectionId);
    }
    if (initialTaskId !== undefined && initialTaskId !== selectedTaskId) {
      setSelectedTaskId(initialTaskId);
      if (initialTaskId) {
        setIsTaskViewActive(true);
      }
    }
  }, [initialHoleId, initialSectionId, initialTaskId]);

  // Dynamic hole selection sync when holeOptions finishes loading
  useEffect(() => {
    if (holeOptions.length > 0 && !holeOptions.some(h => h.id === selectedHoleId)) {
      setSelectedHoleId(holeOptions[0].id);
    }
  }, [holeOptions, selectedHoleId]);

  // Default layer is SATELLITE as requested
  const [activeLayer, setActiveLayer] = useState<HoleViewLayer>('SATELLITE');
  const [mapType, setMapType] = useState<'satellite' | 'hybrid' | 'roadmap'>('satellite');
  
  // 0ms cached polygon initialization
  const [kmlPolygons, setKmlPolygons] = useState<Map<number, LatLng[]>>(() => {
    const initId = initialHoleId || 1;
    return getCachedHoleAreaPolygons(initId) || kmlCacheMap.get(initId) || new Map();
  });
  const [isLoadingKml, setIsLoadingKml] = useState<boolean>(() => {
    const initId = initialHoleId || 1;
    const cached = getCachedHoleAreaPolygons(initId) || kmlCacheMap.get(initId);
    return !(cached && cached.size > 0);
  });
  const [isLayerExpanded, setIsLayerExpanded] = useState<boolean>(false);

  // Live Task State for Hole View instantly synced from props (0ms, matching Android TaskViewModel.kt)
  const [holeViewTasks, setHoleViewTasks] = useState<HomeTaskUi[]>(() => {
    const hId = initialHoleId || 1;
    return tasks.filter(t => t.holeId === hId && (initialSectionId ? t.sectionId === initialSectionId : true));
  });

  useEffect(() => {
    const filtered = tasks.filter(t => t.holeId === selectedHoleId && (selectedSectionId ? t.sectionId === selectedSectionId : true));
    setHoleViewTasks(filtered);
  }, [tasks, selectedHoleId, selectedSectionId]);

  // Satellite Analysis Dates & Grid Data States
  const [satelliteDates, setSatelliteDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [gridData, setGridData] = useState<SatelliteGridItem[]>([]);
  const [isLoadingGrid, setIsLoadingGrid] = useState<boolean>(false);

  // Mowing directions (LANDSCAPE layer)
  const [landscapeSelectedDate, setLandscapeSelectedDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [mowingBySection, setMowingBySection] = useState<Map<number, MowingDirectionDetail[]>>(new Map());
  const [isLoadingMowing, setIsLoadingMowing] = useState<boolean>(false);
  const [mowingResultReady, setMowingResultReady] = useState<boolean>(false);
  const [selectedMowingSectionId, setSelectedMowingSectionId] = useState<number | null>(null);
  const mowingGroundOverlaysRef = useRef<Map<number, any>>(new Map());
  const [showLandscapeDatePicker, setShowLandscapeDatePicker] = useState<boolean>(false);

  useEffect(() => {
    if (selectedSectionId !== null && rawSections.length > 0) {
      const match = rawSections.find(s => s.id === selectedSectionId);
      if (match) {
        const normName = getCanonicalParentCategory(match.description);
        setSelectedSectionName(normName);
      }
    }
  }, [selectedSectionId, rawSections]);

  const uiSections = useMemo<UiSection[]>(() => {
    if (!rawSections || rawSections.length === 0) {
      return [];
    }

    const filtered = rawSections.filter(s => {
      const name = (s.description || '').trim().toLowerCase();
      return name !== 'all sections' && name !== 'all section' && name !== '' &&
        !name.includes('practice') && !name.includes('driving') && !name.includes('all hole');
    });

    const groupedMap = new Map<string, number[]>();
    filtered.forEach(s => {
      const normalizedName = getCanonicalParentCategory(s.description);
      if (!normalizedName) return;

      if (!groupedMap.has(normalizedName)) {
        groupedMap.set(normalizedName, []);
      }
      groupedMap.get(normalizedName)!.push(s.id);
    });

    const result: UiSection[] = [];
    groupedMap.forEach((ids, name) => {
      result.push({
        description: name,
        sectionIds: Array.from(new Set(ids))
      });
    });

    return result;
  }, [rawSections]);

  const availableSectionIds = useMemo<Set<number>>(() => {
    const set = new Set<number>();
    kmlPolygons.forEach((_, secId) => set.add(secId));
    const cachedHole = getCachedHoleSections(selectedHoleId);
    if (cachedHole) {
      cachedHole.forEach(s => {
        if (s.id != null) set.add(s.id);
      });
    }
    tasks.filter(t => t.holeId === selectedHoleId).forEach(t => {
      if (t.sectionId) set.add(t.sectionId);
    });
    mowingBySection.forEach((details, secId) => {
      if (details && details.length > 0) set.add(secId);
    });
    return set;
  }, [selectedHoleId, kmlPolygons, tasks, mowingBySection]);

  const filteredUiSections = useMemo<UiSection[]>(() => {
    if (availableSectionIds.size === 0) return uiSections;
    return uiSections.filter(uiSec =>
      uiSec.sectionIds.some(id => availableSectionIds.has(id))
    );
  }, [uiSections, availableSectionIds]);

  const selectedUiSection = useMemo<UiSection | null>(() => {
    if (!selectedSectionName) return null;
    return filteredUiSections.find(s => s.description === selectedSectionName) || null;
  }, [selectedSectionName, filteredUiSections]);
  
  const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);

  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: GOOGLE_MAPS_API_KEY
  });

  const analysisId = activeLayer === 'MOISTURE' ? 20 : 19;

  const kmlSectionKey = useMemo(() => {
    return Array.from(kmlPolygons.keys()).sort().join(',');
  }, [kmlPolygons]);

  // Load Reference Data dynamically on mount
  useEffect(() => {
    fetchReferenceData().then(data => {
      if (data) {
        if (data.section && data.section.length > 0) {
          setRawSections(data.section.map(s => ({ id: s.id, description: s.description })));
        }
        if (data.holes && data.holes.length > 0) {
          const cleanHoles = data.holes
            .filter(h => {
              const name = (h.name || '').toLowerCase();
              return !name.includes('practice') && !name.includes('driving') && !name.includes('all hole');
            })
            .map(h => ({ id: h.id, name: h.name }));
          if (cleanHoles.length > 0) {
            setHoleOptions(cleanHoles);
          }
        }
      }
    });
  }, []);

  // Fetch KML polygons when hole changes (0ms cache lookup to prevent map flicker)
  useEffect(() => {
    let isMounted = true;
    const cached = getCachedHoleAreaPolygons(selectedHoleId) || kmlCacheMap.get(selectedHoleId);
    if (cached && cached.size > 0) {
      kmlCacheMap.set(selectedHoleId, cached);
      setKmlPolygons(cached);
      setIsLoadingKml(false);
    } else {
      setIsLoadingKml(true);
    }

    fetchHoleAreaPolygons(selectedHoleId)
      .then((polygons) => {
        if (isMounted) {
          kmlCacheMap.set(selectedHoleId, polygons);
          setKmlPolygons(polygons);
          setIsLoadingKml(false);
          prefetchAdjacentHole(selectedHoleId);
        }
      })
      .catch((err) => {
        logSafeError('fetchHoleAreaPolygons', err);
        if (isMounted) setIsLoadingKml(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedHoleId]);

  const currentHoleIdRef = useRef(selectedHoleId);
  currentHoleIdRef.current = selectedHoleId;

  const currentDateRef = useRef(selectedDate);
  currentDateRef.current = selectedDate;

  const currentAnalysisIdRef = useRef(analysisId);
  currentAnalysisIdRef.current = analysisId;

  // Fetch Satellite Dates & Points when Hole, Section, or Layer changes (matching Android DynamicHoleView.kt)
  useEffect(() => {
    if (activeLayer === 'SATELLITE' || activeLayer === 'LANDSCAPE') {
      setSatelliteDates([]);
      setSelectedDate('');
      setGridData([]);
      setIsLoadingGrid(false);
      return;
    }

    let isMounted = true;
    const targetHoleId = selectedHoleId;
    const targetAnalysisId = analysisId;
    const knownSecIds = kmlPolygons.size > 0 ? Array.from(kmlPolygons.keys()) : undefined;
    const targetSecIds = selectedUiSection ? selectedUiSection.sectionIds : selectedSectionId;

    // Check cache first for 0ms instant display
    const cachedDates = getCachedSatelliteDates(targetHoleId, targetSecIds, targetAnalysisId);
    if (cachedDates && cachedDates.length > 0) {
      setSatelliteDates(cachedDates);
      const firstDate = cachedDates[0];
      setSelectedDate(firstDate);
      const cachedGrid = getCachedSatelliteGridData(targetHoleId, targetSecIds, firstDate, targetAnalysisId);
      if (cachedGrid && cachedGrid.length > 0) {
        setGridData(cachedGrid);
        setIsLoadingGrid(false);
      }
    } else {
      setIsLoadingGrid(true);
    }

    fetchSatelliteDates(targetHoleId, targetSecIds, targetAnalysisId, knownSecIds)
      .then((dates) => {
        if (!isMounted || currentHoleIdRef.current !== targetHoleId) return;
        setSatelliteDates(dates);
        if (dates.length > 0) {
          const firstDate = dates[0];
          setSelectedDate(firstDate);
          const cachedGrid = getCachedSatelliteGridData(targetHoleId, targetSecIds, firstDate, targetAnalysisId);
          if (cachedGrid && cachedGrid.length > 0) {
            setGridData(cachedGrid);
            setIsLoadingGrid(false);
          } else {
            fetchSatelliteGridData(targetHoleId, targetSecIds, firstDate, targetAnalysisId, knownSecIds)
              .then((grid) => {
                if (isMounted && currentHoleIdRef.current === targetHoleId) {
                  setGridData(grid);
                  setIsLoadingGrid(false);
                }
              })
              .catch(() => {
                if (isMounted) setIsLoadingGrid(false);
              });
          }
        } else {
          setSelectedDate('');
          setGridData([]);
          setIsLoadingGrid(false);
        }
      })
      .catch((err) => {
        logSafeError('fetchSatelliteDates', err);
        if (isMounted && currentHoleIdRef.current === targetHoleId) setIsLoadingGrid(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedHoleId, selectedSectionId, activeLayer, analysisId, kmlSectionKey, selectedUiSection]);

  // Fetch Satellite Grid Data when user explicitly picks a date from dropdown
  useEffect(() => {
    if (!selectedDate || activeLayer === 'SATELLITE' || activeLayer === 'LANDSCAPE') return;

    let isMounted = true;
    const targetHoleId = selectedHoleId;
    const targetDate = selectedDate;
    const targetAnalysisId = analysisId;
    const targetSecIds = selectedUiSection ? selectedUiSection.sectionIds : selectedSectionId;

    const cachedGrid = getCachedSatelliteGridData(targetHoleId, targetSecIds, targetDate, targetAnalysisId);
    if (cachedGrid && cachedGrid.length > 0) {
      setGridData(cachedGrid);
      setIsLoadingGrid(false);
      return;
    }

    setIsLoadingGrid(true);
    const knownSecIds = kmlPolygons.size > 0 ? Array.from(kmlPolygons.keys()) : undefined;
    fetchSatelliteGridData(targetHoleId, targetSecIds, targetDate, targetAnalysisId, knownSecIds)
      .then((grid) => {
        if (
          isMounted &&
          currentHoleIdRef.current === targetHoleId &&
          currentDateRef.current === targetDate &&
          currentAnalysisIdRef.current === targetAnalysisId
        ) {
          setGridData(grid);
          setIsLoadingGrid(false);
        }
      })
      .catch((err) => {
        logSafeError('fetchSatelliteGridData', err);
        if (isMounted && currentHoleIdRef.current === targetHoleId) setIsLoadingGrid(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedDate]);

  // Format date for bottom mowing cards (dd.MM.yy matching Android formatDate)
  const formatMowingDate = useCallback((isoDateString?: string): string => {
    if (!isoDateString || !isoDateString.trim()) return '';
    try {
      const d = new Date(isoDateString);
      if (!isNaN(d.getTime())) {
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = String(d.getFullYear()).slice(-2);
        return `${day}.${month}.${year}`;
      }
    } catch {
      // fallback
    }
    return isoDateString.slice(0, 10).replace(/-/g, '.');
  }, []);

  // Fetch mowing directions for all sections of the hole when in LANDSCAPE mode
  useEffect(() => {
    setSelectedMowingSectionId(null);

    if (activeLayer !== 'LANDSCAPE' || !selectedHoleId) {
      setMowingBySection(new Map());
      setMowingResultReady(false);
      setIsLoadingMowing(false);
      return;
    }

    let isMounted = true;
    setIsLoadingMowing(true);
    setMowingResultReady(false);

    const loadHoleMowing = async () => {
      const candidateSecIds = new Set<number>();

      // 1. All sections with KML outlines on this hole
      kmlPolygons.forEach((_, id) => candidateSecIds.add(id));

      // 2. All sections from HoleArea for this hole (Tee, Approach, Fairway, Green)
      let holeSecs = getCachedHoleSections(selectedHoleId);
      if (!holeSecs || holeSecs.length === 0) {
        holeSecs = await fetchHoleSections(selectedHoleId);
      }
      if (holeSecs && holeSecs.length > 0) {
        holeSecs.forEach(s => {
          if (s.id != null) candidateSecIds.add(s.id);
        });
      }

      // 3. Sections from tasks for this hole
      tasks.filter(t => t.holeId === selectedHoleId).forEach(t => {
        if (t.sectionId != null) candidateSecIds.add(t.sectionId);
      });

      // 4. All course section categories from ReferenceData (rawSections / uiSections, ensuring Approach, Tee, Fairway, Green are queried)
      uiSections.forEach(uiSec => {
        uiSec.sectionIds.forEach(id => candidateSecIds.add(id));
      });

      const secIds = Array.from(candidateSecIds);

      // Check cache first for 0ms instant display
      const cachedMowMap = new Map<number, MowingDirectionDetail[]>();
      let allCached = secIds.length > 0;
      secIds.forEach(id => {
        const c = getCachedMowingDirections(selectedHoleId, id, landscapeSelectedDate);
        if (c) cachedMowMap.set(id, c);
        else allCached = false;
      });
      if (allCached && cachedMowMap.size > 0 && isMounted) {
        setMowingBySection(cachedMowMap);
        setMowingResultReady(true);
        setIsLoadingMowing(false);
      }

      return fetchMowingDirectionsSectionWise(selectedHoleId, secIds, landscapeSelectedDate, rawSections);
    };

    loadHoleMowing()
      .then((bySec) => {
        if (!isMounted) return;
        setMowingBySection(bySec);
        setMowingResultReady(true);
        setIsLoadingMowing(false);
      })
      .catch((err) => {
        logSafeError('fetchMowingDirectionsSectionWise', err);
        if (!isMounted) return;
        setMowingBySection(new Map());
        setMowingResultReady(true);
        setIsLoadingMowing(false);
      });

    return () => {
      isMounted = false;
    };
  }, [activeLayer, selectedHoleId, kmlSectionKey, landscapeSelectedDate, rawSections, uiSections, tasks]);

  // Helper to find the section description for any section ID on the current hole
  const getSectionDescription = useCallback((secId: number): string => {
    const cachedHoleSecs = getCachedHoleSections(selectedHoleId) || [];
    const fromHole = cachedHoleSecs.find(s => s.id === secId)?.description;
    if (fromHole) return fromHole.trim();

    const fromRaw = rawSections.find(s => s.id === secId)?.description;
    if (fromRaw) return fromRaw.trim();

    const fromTask = tasks.find(t => t.holeId === selectedHoleId && t.sectionId === secId)?.sectionDescription;
    if (fromTask) return fromTask.trim();

    const fromMowing = mowingBySection.get(secId)?.[0]?.section;
    if (fromMowing) return fromMowing.trim();

    return '';
  }, [selectedHoleId, rawSections, tasks, mowingBySection]);

  // Compute stripe layers per section using MowingPatternResolver (with canonical category & Tee fallback)
  const stripeAxesBySection = useMemo<Map<number, number[]>>(() => {
    if (!mowingResultReady || activeLayer !== 'LANDSCAPE') {
      return new Map();
    }

    const result = new Map<number, number[]>();

    // For every polygon on this hole:
    kmlPolygons.forEach((_, secId) => {
      const secDesc = getSectionDescription(secId);
      const cat = getCanonicalParentCategory(secDesc);

      // Rough sections never have mowing stripes
      if (cat.toLowerCase().includes('rough')) return;

      // 1. Direct mowing details for this sectionId
      // Copy so the fallbacks below never modify the shared mowingBySection data
      let details: MowingDirectionDetail[] = [...(mowingBySection.get(secId) || [])];

      // 2. If no direct details, resolve from canonical category across mowingBySection
      if (details.length === 0 && cat) {
        const catKey = cat.toLowerCase();
        mowingBySection.forEach((dList, sId) => {
          if (!dList || dList.length === 0) return;
          const sDesc = getSectionDescription(sId);
          const sCat = getCanonicalParentCategory(sDesc);
          if (sCat.toLowerCase() === catKey) {
            dList.forEach(d => {
              if (!details.some(m => m.mowingDirection === d.mowingDirection && m.mowingType === d.mowingType)) {
                details.push(d);
              }
            });
          } else {
            // Also check individual detail.section
            dList.forEach(d => {
              if (getCanonicalParentCategory(d.section).toLowerCase() === catKey) {
                if (!details.some(m => m.mowingDirection === d.mowingDirection && m.mowingType === d.mowingType)) {
                  details.push(d);
                }
              }
            });
          }
        });
      }

      // 3. Tee fallback: If this is a Tee section and still has no details, copy from any Tee on this hole
      if (details.length === 0 && cat === 'Tee') {
        mowingBySection.forEach((dList, sId) => {
          if (!dList || dList.length === 0) return;
          const sDesc = getSectionDescription(sId);
          if (getCanonicalParentCategory(sDesc) === 'Tee') {
            dList.forEach(d => {
              if (!details.some(m => m.mowingDirection === d.mowingDirection && m.mowingType === d.mowingType)) {
                details.push(d);
              }
            });
          }
        });
      }

      // Resolve axes for this polygon
      if (details.length > 0) {
        // Only the newest dashboard entry is current (older saves stay in the API response)
        const axes = resolveLayers(latestEntryOnly(details));
        if (axes.length > 0) {
          result.set(secId, axes);
        }
      }
    });

    return result;
  }, [mowingResultReady, activeLayer, kmlPolygons, mowingBySection, getSectionDescription]);

  // Stable view of the stripe layers for drawing: while mowing data is (re)loading keep showing the
  // last result, and only hand out a new Map when the stripe content actually changes. Without this
  // every tasks/sections refresh clears and redraws all overlays, which makes them flicker.
  const lastStripeAxesRef = useRef<Map<number, number[]>>(new Map());
  const lastStripeSigRef = useRef<string>('');
  const stableStripeAxesBySection = useMemo<Map<number, number[]>>(() => {
    if (activeLayer !== 'LANDSCAPE') {
      lastStripeAxesRef.current = new Map();
      lastStripeSigRef.current = '';
      return lastStripeAxesRef.current;
    }
    if (!mowingResultReady) return lastStripeAxesRef.current;
    const sig = Array.from(stripeAxesBySection.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([id, axes]) => `${id}:${axes.join(',')}`)
      .join('|');
    if (sig !== lastStripeSigRef.current) {
      lastStripeSigRef.current = sig;
      lastStripeAxesRef.current = stripeAxesBySection;
    }
    return lastStripeAxesRef.current;
  }, [activeLayer, mowingResultReady, stripeAxesBySection]);

  // Compute bottom mowing cards data (matching Android DynamicHoleView.kt & LandscapeMowingScreen.kt)
  interface MowingSectionCardData {
    sectionId: number;
    title: string;
    directions: string[];
    date: string;
    isSelected: boolean;
  }

  const mowingCards = useMemo<MowingSectionCardData[]>(() => {
    if (activeLayer !== 'LANDSCAPE' || mowingBySection.size === 0) return [];

    const cachedHoleSecs = getCachedHoleSections(selectedHoleId) || [];
    const secIdToName = new Map<number, string>();

    // Priority 1: HoleArea section descriptions
    cachedHoleSecs.forEach(s => {
      if (s.id != null && s.description) secIdToName.set(s.id, s.description.trim());
    });

    // Priority 2: ReferenceData section descriptions
    rawSections.forEach(s => {
      if (s.id != null && !secIdToName.has(s.id) && s.description) {
        secIdToName.set(s.id, s.description.trim());
      }
    });

    // Strictly check if any mowing data was returned for this hole on this date
    let hasAnyMowingData = false;
    mowingBySection.forEach((details) => {
      if (details && details.length > 0) {
        hasAnyMowingData = true;
      }
    });

    if (!hasAnyMowingData) {
      return [];
    }

    // Canonical playing categories sequence: Approach -> Fairway -> Tee -> Green
    // Strictly NO Rough, and strictly combine all Tee sections (Tee, Tee 1, Tee I, Tee 2) into one single 'Tee' card!
    const canonicalCategories = ['Approach', 'Fairway', 'Tee', 'Green'];
    const categoryMap = new Map<string, {
      title: string;
      primarySectionId: number;
      details: MowingDirectionDetail[];
    }>();

    // 1. Initialize the 4 canonical categories
    canonicalCategories.forEach((catName) => {
      const key = catName.toLowerCase();
      let primaryId = 0;
      const matchUi = uiSections.find(u => getCanonicalParentCategory(u.description) === catName);
      if (matchUi && matchUi.sectionIds.length > 0) {
        primaryId = matchUi.sectionIds[0];
      } else {
        const matchHole = cachedHoleSecs.find(s => getCanonicalParentCategory(s.description) === catName);
        if (matchHole && matchHole.id != null) {
          primaryId = matchHole.id;
        } else {
          const matchRaw = rawSections.find(s => getCanonicalParentCategory(s.description) === catName);
          if (matchRaw && matchRaw.id != null) {
            primaryId = matchRaw.id;
          }
        }
      }

      categoryMap.set(key, {
        title: catName,
        primarySectionId: primaryId,
        details: []
      });
    });

    // 2. Collect all mowing details into their canonical category
    mowingBySection.forEach((details, secId) => {
      if (!details || details.length === 0) return;

      details.forEach((d) => {
        const rawName = d.section || secIdToName.get(secId) || '';
        const cat = getCanonicalParentCategory(rawName);
        const key = cat.toLowerCase();

        // Strictly remove rough
        if (key.includes('rough')) return;

        if (categoryMap.has(key)) {
          const entry = categoryMap.get(key)!;
          if (entry.primarySectionId === 0 && secId > 0) {
            entry.primarySectionId = secId;
          }
          if (!entry.details.some(m => m.mowingDirection === d.mowingDirection && m.mowingType === d.mowingType)) {
            entry.details.push(d);
          }
        } else if (cat) {
          categoryMap.set(key, {
            title: cat,
            primarySectionId: secId,
            details: [d]
          });
        }
      });
    });

    // 3. Build card data for each category
    const cards: MowingSectionCardData[] = [];
    categoryMap.forEach(({ title, primarySectionId, details: allDetails }) => {
      // One card per category shows only its newest dashboard entry, matching the dashboard
      const details = latestEntryOnly(allDetails);
      const directions: string[] = [];
      details.forEach((d) => {
        const raw = d.mowingDirection || '';
        const parts = raw.split(/[,/&+]/).map(p => p.trim()).filter(Boolean);
        if (parts.length > 1) {
          parts.forEach(p => directions.push(p.replace(/\s+to\s+/gi, ' - ')));
        } else if (raw.trim()) {
          directions.push(raw.replace(/\s+to\s+/gi, ' - '));
        }
      });

      const uniqueDirs = Array.from(new Set(directions));
      const rawDate = details[0]?.mowingDate || landscapeSelectedDate;

      cards.push({
        sectionId: primarySectionId,
        title,
        directions: uniqueDirs.length > 0 ? uniqueDirs : ['-'],
        date: formatMowingDate(rawDate),
        isSelected: selectedMowingSectionId === primarySectionId
      });
    });

    // 4. Sequence strictly in order: Approach -> Fairway -> Tee -> Green
    const getOrderRank = (cardTitle: string): number => {
      const t = cardTitle.toLowerCase();
      if (t.includes('approach')) return 1;
      if (t.includes('fairway')) return 2;
      if (t.includes('tee')) return 3;
      if (t.includes('green')) return 4;
      return 10;
    };

    return cards
      .filter(card => !card.title.toLowerCase().includes('rough'))
      .sort((a, b) => getOrderRank(a.title) - getOrderRank(b.title));
  }, [
    activeLayer,
    mowingBySection,
    selectedMowingSectionId,
    selectedHoleId,
    rawSections,
    uiSections,
    landscapeSelectedDate,
    formatMowingDate
  ]);

  // Native GroundOverlays for the LANDSCAPE layer: solid fills for sections without stripes and
  // mowing stripe patterns for the rest. Rebuilt only when what they show actually changes.
  const mowingOverlaySigRef = useRef<string>('');
  const clearMowingOverlays = useCallback(() => {
    mowingGroundOverlaysRef.current.forEach((ov) => ov.setMap(null));
    mowingGroundOverlaysRef.current.clear();
    mowingOverlaySigRef.current = '';
  }, []);

  useEffect(() => {
    if (!mapInstance || !window.google) return;

    if (activeLayer !== 'LANDSCAPE') {
      clearMowingOverlays();
      return;
    }

    // Content signature: section ids, their stripe axes and polygon shapes
    const sig = Array.from(kmlPolygons.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([secId, pts]) => {
        const first = pts[0];
        const last = pts[pts.length - 1];
        const axes = stableStripeAxesBySection.get(secId) || [];
        return `${secId}:${axes.join(',')}:${pts.length}:${first?.lat},${first?.lng}:${last?.lat},${last?.lng}`;
      })
      .join('|');
    if (sig === mowingOverlaySigRef.current && mowingGroundOverlaysRef.current.size > 0) return;

    clearMowingOverlays();
    mowingOverlaySigRef.current = sig;

    // One geographic stripe pivot for the whole hole, so overlapping sections line up
    const allPoints: LatLng[] = [];
    kmlPolygons.forEach((pts) => allPoints.push(...pts));
    if (allPoints.length === 0) return;
    const holeBounds = computePolygonBounds(allPoints);
    const anchor: LatLng = {
      lat: (holeBounds.southwest.lat + holeBounds.northeast.lat) / 2,
      lng: (holeBounds.southwest.lng + holeBounds.northeast.lng) / 2
    };

    // Largest sections first: GroundOverlays stack in the order they are added, so smaller
    // sections (tees, greens) sit on top of the larger ones around them.
    const ordered = Array.from(kmlPolygons.entries())
      .filter(([, pts]) => pts && pts.length >= 3)
      .map(([secId, pts]) => {
        const b = computePolygonBounds(pts);
        const area = (b.northeast.lat - b.southwest.lat) * (b.northeast.lng - b.southwest.lng);
        return { secId, pts, b, area };
      })
      .sort((x, y) => y.area - x.area);

    ordered.forEach(({ secId, pts, b }) => {
      const axes = stableStripeAxesBySection.get(secId) || [];
      const dataUrl = axes.length > 0
        ? createMowingStripeOverlay(axes, pts, b, anchor)
        : createSolidSectionOverlay(pts, b, '#4E9A3E', 0.85);
      if (!dataUrl) return;

      const gBounds = new window.google.maps.LatLngBounds(
        new window.google.maps.LatLng(b.southwest.lat, b.southwest.lng),
        new window.google.maps.LatLng(b.northeast.lat, b.northeast.lng)
      );
      const overlay = new window.google.maps.GroundOverlay(dataUrl, gBounds, {
        opacity: 1.0,
        clickable: false
      });
      overlay.setMap(mapInstance);
      mowingGroundOverlaysRef.current.set(secId, overlay);
    });
  }, [mapInstance, activeLayer, stableStripeAxesBySection, kmlPolygons, clearMowingOverlays]);

  // Remove mowing overlays when the screen unmounts
  useEffect(() => clearMowingOverlays, [clearMowingOverlays]);

  // Compute centroid & bounds strictly from KML boundary points (prevents grid re-fetching map camera fluctuations)
  const kmlBoundaryPoints = useMemo(() => {
    const pts: LatLng[] = [];
    kmlPolygons.forEach((points) => {
      pts.push(...points);
    });
    return pts;
  }, [kmlPolygons]);

  const centroid = useMemo(() => {
    if (kmlBoundaryPoints.length === 0) return getDefaultCenter();
    const latSum = kmlBoundaryPoints.reduce((acc, p) => acc + p.lat, 0);
    const lngSum = kmlBoundaryPoints.reduce((acc, p) => acc + p.lng, 0);
    return {
      lat: latSum / kmlBoundaryPoints.length,
      lng: lngSum / kmlBoundaryPoints.length
    };
  }, [kmlBoundaryPoints]);

  // Generate High-Precision Gapless Grid Squares strictly bounded by current hole sections
  const computed10mGrid = useMemo(() => {
    if (activeLayer === 'SATELLITE' || gridData.length === 0 || kmlPolygons.size === 0) return [];

    const cacheKey = `${selectedHoleId}_${kmlPolygons.size}`;
    let baseCells = holeBaseCellsCache.get(cacheKey);
    if (!baseCells || baseCells.length === 0) {
      baseCells = [];
      const holeCentroidLat = centroid.lat || 19.05;
      kmlPolygons.forEach((points, secId) => {
        baseCells!.push(...computeBaseGridCellsForSection(secId, points, selectedHoleId, holeCentroidLat));
      });
      if (baseCells.length > 0) {
        holeBaseCellsCache.set(cacheKey, baseCells);
      }
    }

    const filteredCells = selectedUiSection 
      ? baseCells.filter(c => selectedUiSection.sectionIds.includes(c.sectionId))
      : baseCells;

    const validHolePoints = gridData.filter(p => !p.hole_id || p.hole_id === selectedHoleId);
    if (validHolePoints.length === 0) return [];

    return colorBaseGridCells(filteredCells, validHolePoints, activeLayer === 'MOISTURE', selectedHoleId);
  }, [activeLayer, kmlPolygons, selectedUiSection, selectedHoleId, gridData, centroid.lat]);

  const lastFittedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!mapInstance || !window.google || kmlBoundaryPoints.length === 0) return;

    const fitKey = `${selectedHoleId}_${kmlBoundaryPoints.length}`;
    if (lastFittedKeyRef.current !== fitKey) {
      lastFittedKeyRef.current = fitKey;

      const latSum = kmlBoundaryPoints.reduce((acc, p) => acc + p.lat, 0);
      const lngSum = kmlBoundaryPoints.reduce((acc, p) => acc + p.lng, 0);
      const centerLat = latSum / kmlBoundaryPoints.length;
      const centerLng = lngSum / kmlBoundaryPoints.length;

      // Trigger Google Maps viewport resize in case tab was hidden
      window.google.maps.event.trigger(mapInstance, 'resize');
      mapInstance.panTo({ lat: centerLat, lng: centerLng });

      const bounds = new window.google.maps.LatLngBounds();
      kmlBoundaryPoints.forEach((pt) => bounds.extend(pt));
      mapInstance.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });
    }
  }, [mapInstance, selectedHoleId, kmlBoundaryPoints]);

  const onLoadMap = useCallback((map: google.maps.Map) => {
    map.setMapTypeId('satellite');
    setMapInstance(map);
  }, []);

  const onUnmountMap = useCallback(() => {
    setMapInstance(null);
  }, []);

  // Live tasks are synchronized instantly (0ms) from props.tasks matching Android TaskViewModel.kt

  // Compute section centroids for placing task markers accurately on Google Maps
  const sectionCentroids = useMemo(() => {
    const map = new Map<number, LatLng>();
    kmlPolygons.forEach((pts, secId) => {
      if (pts.length > 0) {
        const latSum = pts.reduce((acc, p) => acc + p.lat, 0);
        const lngSum = pts.reduce((acc, p) => acc + p.lng, 0);
        map.set(secId, { lat: latSum / pts.length, lng: lngSum / pts.length });
      }
    });
    return map;
  }, [kmlPolygons]);

  // Auto-pan to selected task pin on Google Maps
  useEffect(() => {
    if (selectedTaskId && mapInstance && holeViewTasks.length > 0) {
      const taskIndex = holeViewTasks.findIndex(t => t.id === selectedTaskId);
      if (taskIndex !== -1) {
        const task = holeViewTasks[taskIndex];
        const hasLatLng = typeof task.latitude === 'number' && task.latitude !== 0 && typeof task.longitude === 'number' && task.longitude !== 0;
        const secPos = task.sectionId ? sectionCentroids.get(task.sectionId) : null;
        const pos = hasLatLng ? { lat: task.latitude!, lng: task.longitude! } : (secPos || {
          lat: centroid.lat + (taskIndex * 0.00015 - 0.0001),
          lng: centroid.lng + (taskIndex * 0.00015 - 0.0001)
        });
        lastFittedKeyRef.current = `${selectedHoleId}_task`;
        mapInstance.panTo(pos);
        mapInstance.setZoom(19);
      }
    }
  }, [selectedTaskId, mapInstance, holeViewTasks, sectionCentroids, centroid, selectedHoleId]);

  // Trigger Google Maps viewport resize repaint when map or hole activates (eliminates grey tile flickering)
  useEffect(() => {
    if (mapInstance && window.google) {
      window.google.maps.event.trigger(mapInstance, 'resize');
    }
  }, [mapInstance, selectedHoleId]);

  // Native Google Maps JS Polygon overlays for 0ms ultra-fast 60 FPS rendering
  const gridPolygonsRef = useRef<any[]>([]);
  const kmlPolygonMapRef = useRef<Map<number, any>>(new Map());

  // 1. Draw Double-Buffered Native Grid Tiles directly on Google Map (zero 1-frame blank gap)
  useEffect(() => {
    if (!mapInstance || !window.google) return;

    const oldPolys = [...gridPolygonsRef.current];

    if (activeLayer === 'SATELLITE') {
      oldPolys.forEach((p: any) => p.setMap(null));
      gridPolygonsRef.current = [];
      return;
    }

    const newGridPolys: any[] = [];
    computed10mGrid.forEach(sq => {
      const poly = new window.google.maps.Polygon({
        paths: sq.bounds,
        fillColor: sq.color,
        fillOpacity: 1.0,
        strokeColor: '#FFFFFF',
        strokeOpacity: 0.6,
        strokeWeight: 0.8,
        zIndex: 100,
        clickable: false,
        map: mapInstance
      });
      newGridPolys.push(poly);
    });

    gridPolygonsRef.current = newGridPolys;

    // Remove old tiles AFTER new tiles are painted (double-buffered smooth transition)
    requestAnimationFrame(() => {
      oldPolys.forEach((p: any) => p.setMap(null));
    });

    return () => {
      newGridPolys.forEach((p: any) => p.setMap(null));
      gridPolygonsRef.current = [];
    };
  }, [mapInstance, activeLayer, computed10mGrid]);

  const currentRenderedHoleIdRef = useRef<number | null>(null);

  // 2. Draw & Update In-Place Native White KML Section Outlines (zero flicker on section switch)
  useEffect(() => {
    if (!mapInstance || !window.google) return;

    let needsRebuild = false;
    if (currentRenderedHoleIdRef.current !== selectedHoleId || kmlPolygonMapRef.current.size !== kmlPolygons.size) {
      needsRebuild = true;
    } else {
      kmlPolygons.forEach((_, secId) => {
        if (!kmlPolygonMapRef.current.has(secId)) needsRebuild = true;
      });
    }

    if (needsRebuild) {
      currentRenderedHoleIdRef.current = selectedHoleId;
      kmlPolygonMapRef.current.forEach((p: any) => p.setMap(null));
      kmlPolygonMapRef.current.clear();

      kmlPolygons.forEach((points, secId) => {
        const isHighlighted = activeLayer === 'LANDSCAPE' || (selectedUiSection 
          ? selectedUiSection.sectionIds.includes(secId)
          : (selectedSectionId === null || selectedSectionId === secId));

        // Section fills (solid or striped) are drawn as GroundOverlays; polygons are outlines only
        const strokeColor = activeLayer === 'MOISTURE' ? '#90CAF9' : '#FFFFFF';
        const fillColor = 'transparent';
        const fillOpacity = 0;

        const poly = new window.google.maps.Polygon({
          paths: points,
          fillColor: fillColor,
          fillOpacity: fillOpacity,
          strokeColor: strokeColor,
          strokeOpacity: 1.0,
          strokeWeight: 2.5,
          zIndex: 120,
          clickable: false,
          map: isHighlighted ? mapInstance : null
        });
        kmlPolygonMapRef.current.set(secId, poly);
      });
    } else {
      // In-place visibility & styling update matching Android DynamicHoleView.kt
      kmlPolygons.forEach((points, secId) => {
        const poly = kmlPolygonMapRef.current.get(secId);
        const isHighlighted = activeLayer === 'LANDSCAPE' || (selectedUiSection 
          ? selectedUiSection.sectionIds.includes(secId)
          : (selectedSectionId === null || selectedSectionId === secId));

        // Section fills (solid or striped) are drawn as GroundOverlays; polygons are outlines only
        const strokeColor = activeLayer === 'MOISTURE' ? '#90CAF9' : '#FFFFFF';
        const fillColor = 'transparent';
        const fillOpacity = 0;

        if (poly) {
          poly.setOptions({
            paths: points,
            fillColor,
            fillOpacity,
            strokeColor,
            strokeOpacity: 1.0,
            strokeWeight: 2.5,
            zIndex: 120,
            map: isHighlighted ? mapInstance : null
          });
        } else if (isHighlighted) {
          const newPoly = new window.google.maps.Polygon({
            paths: points,
            fillColor: fillColor,
            fillOpacity: fillOpacity,
            strokeColor: strokeColor,
            strokeOpacity: 1.0,
            strokeWeight: 2.5,
            zIndex: 120,
            clickable: false,
            map: mapInstance
          });
          kmlPolygonMapRef.current.set(secId, newPoly);
        }
      });
    }
  }, [mapInstance, kmlPolygons, selectedSectionId, selectedUiSection, activeLayer]);

  const layerOptions: Array<{ id: HoleViewLayer; label: string; image: string }> = [
    { id: 'SATELLITE', label: 'SATELLITE', image: '/assets/img_layer_satellite.png' },
    { id: 'MOISTURE', label: 'MOISTURE', image: '/assets/img_layer_moisture.png' },
    { id: 'VEG_STRESS', label: 'TURF HEALTH', image: '/assets/img_layer_veg_stress.png' },
    { id: 'LANDSCAPE', label: 'LANDSCAPE', image: '/assets/img_layer_landscape.png' }
  ];

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Floating Layer Selector (Inline with Hole & Section Dropdowns at top: 12px, zIndex: 50) */}
      <div className="floating-layer-selector">
        {!isLayerExpanded ? (
          <div
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer' }}
            onClick={() => setIsLayerExpanded(true)}
          >
            <span className="layer-label">
              {layerOptions.find(l => l.id === activeLayer)?.label}
            </span>
            <img
              src={layerOptions.find(l => l.id === activeLayer)?.image}
              alt="layer"
              className="layer-thumb"
            />
            <ChevronDown
              size={18}
              color="#FFFFFF"
              style={{ cursor: 'pointer', marginTop: 4 }}
            />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            {layerOptions.map((opt) => (
              <div
                key={opt.id}
                className={`layer-item ${activeLayer === opt.id ? 'selected' : ''}`}
                onClick={() => {
                  setActiveLayer(opt.id);
                  setIsLayerExpanded(false);
                }}
              >
                <span className="layer-label">{opt.label}</span>
                <img src={opt.image} alt={opt.label} className="layer-thumb" />
              </div>
            ))}
            <ChevronUp
              size={22}
              color="#FFFFFF"
              style={{ cursor: 'pointer', marginTop: 4 }}
              onClick={() => setIsLayerExpanded(false)}
            />
          </div>
        )}
      </div>

      {/* Top Controls Header Bar: Hole, Section & Date Filter */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 'calc(12px + env(safe-area-inset-top, 0px)) 16px 12px 16px',
        backgroundColor: 'var(--gs-bg)',
        zIndex: 5
      }}>
        {/* Row 1: Hole Dropdown & Section Dropdown (paddingRight leaves room for Floating Layer Selector) */}
        <div style={{ display: 'flex', gap: 8, paddingRight: 94 }}>
          {/* Hole Dropdown */}
          <div style={{ flex: 1, position: 'relative' }}>
            <select
              value={selectedHoleId}
              onChange={(e) => {
                const newHoleId = Number(e.target.value);
                setSelectedHoleId(newHoleId);
                setSelectedSectionName(null);
                setSelectedSectionId(null);
                setSelectedDate('');
                setSatelliteDates([]);
                setGridData([]);
                setKmlPolygons(new Map());
                lastFittedKeyRef.current = null;
                clearL1GridCache();
                onHoleChange?.(newHoleId, null);
              }}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 4,
                backgroundColor: '#585858',
                color: '#F2F2F2',
                border: 'none',
                fontSize: 14,
                fontWeight: 500,
                appearance: 'none',
                WebkitAppearance: 'none',
                cursor: 'pointer'
              }}
            >
              {holeOptions.map(hole => (
                <option key={hole.id} value={hole.id}>
                  {hole.name.replace('_', ' ')}
                </option>
              ))}
            </select>
            <ChevronDown size={18} color="#F2F2F2" style={{ position: 'absolute', right: 10, top: 12, pointerEvents: 'none' }} />
          </div>

          {/* Dynamic Second Control: Section Dropdown for Satellite/Moisture/Turf OR Calendar Picker for Landscape */}
          {activeLayer === 'LANDSCAPE' ? (
            <button
              type="button"
              onClick={() => setShowLandscapeDatePicker(true)}
              style={{
                flex: 1,
                height: 42,
                borderRadius: 4,
                backgroundColor: '#585858',
                color: '#F2F2F2',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 12px',
                border: 'none',
                cursor: 'pointer',
                boxSizing: 'border-box'
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
              >
                {landscapeSelectedDate}
              </span>
              <Calendar size={16} color="#F2F2F2" style={{ flexShrink: 0, marginLeft: 8 }} />
            </button>
          ) : (
            <div style={{ flex: 1, position: 'relative' }}>
              <select
                value={selectedSectionName ?? ''}
                onChange={(e) => {
                  const name = e.target.value || null;
                  setSelectedSectionName(name);
                  let newSecId: number | null = null;
                  if (name) {
                    const match = filteredUiSections.find(s => s.description === name);
                    newSecId = match && match.sectionIds.length > 0 ? match.sectionIds[0] : null;
                  }
                  setSelectedSectionId(newSecId);
                  onHoleChange?.(selectedHoleId, newSecId);
                }}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 4,
                  backgroundColor: '#585858',
                  color: '#F2F2F2',
                  border: 'none',
                  fontSize: 14,
                  fontWeight: 500,
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="">All Sections</option>
                {filteredUiSections.map(sec => (
                  <option key={sec.description} value={sec.description}>
                    {sec.description}
                  </option>
                ))}
              </select>
              <ChevronDown size={18} color="#F2F2F2" style={{ position: 'absolute', right: 10, top: 12, pointerEvents: 'none' }} />
            </div>
          )}
        </div>

        {/* Row 2: Date Filter Dropdown Above (Visible when Satellite Analysis Layer is Active; paddingRight matches Row 1 to keep it till the section) */}
        {activeLayer !== 'SATELLITE' && activeLayer !== 'LANDSCAPE' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingRight: 94 }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <select
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 4,
                  backgroundColor: '#585858',
                  color: '#F2F2F2',
                  border: 'none',
                  fontSize: 14,
                  fontWeight: 500,
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  cursor: 'pointer'
                }}
              >
                {satelliteDates.length === 0 ? (
                  <option value="">No dates available</option>
                ) : (
                  satelliteDates.map(d => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))
                )}
              </select>
              <ChevronDown size={18} color="#F2F2F2" style={{ position: 'absolute', right: 10, top: 12, pointerEvents: 'none' }} />
            </div>
          </div>
        )}
      </div>

      {/* Map Container */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {!isLoaded ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', backgroundColor: '#1C2826', color: '#FFFFFF', fontSize: 14 }}>
            {loadError ? 'Map failed to load. Check API Key.' : 'Loading Google Maps...'}
          </div>
        ) : (
          <GoogleMap
            mapContainerStyle={mapContainerStyle}
            center={initialMapCenterRef.current}
            zoom={18}
            mapTypeId={mapType}
            onLoad={onLoadMap}
            onUnmount={onUnmountMap}
            options={{
              mapTypeId: 'satellite',
              zoomControl: false,
              mapTypeControl: false,
              streetViewControl: false,
              fullscreenControl: false,
              rotateControl: false,
              gestureHandling: 'greedy'
            }}
          >
            {/* Task Pin Markers on Google Maps (Rendered ONLY when Task View is active) */}
            {isTaskViewActive && kmlBoundaryPoints.length > 0 && holeViewTasks.map((t, tIdx) => {
              const hasLatLng = typeof t.latitude === 'number' && t.latitude !== 0 && typeof t.longitude === 'number' && t.longitude !== 0;
              const secPos = t.sectionId ? sectionCentroids.get(t.sectionId) : null;
              const pos = hasLatLng ? { lat: t.latitude!, lng: t.longitude! } : (secPos || {
                lat: centroid.lat + (tIdx * 0.00015 - 0.0001),
                lng: centroid.lng + (tIdx * 0.00015 - 0.0001)
              });

              const isSelected = selectedTaskId === t.id;

              // Red Location Pin Icon (matches Android code's default red marker)
              const redPinSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="46" viewBox="0 0 34 46">
                <defs>
                  <filter id="pinShadow" x="-30%" y="-20%" width="160%" height="150%">
                    <feDropShadow dx="0" dy="2" stdDeviation="1.8" flood-color="#000000" flood-opacity="0.45"/>
                  </filter>
                </defs>
                <path d="M17 1C8.716 1 2 7.716 2 16c0 11.5 15 28 15 28s15-16.5 15-28c0-8.284-6.716-15-15-15z" fill="#EB3532" stroke="#B71C1C" stroke-width="0.8" filter="url(#pinShadow)"/>
                <circle cx="17" cy="16" r="5.5" fill="#7F0000" opacity="0.85"/>
              </svg>`;

              const redPinIcon = window.google ? {
                url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(redPinSvg),
                scaledSize: new window.google.maps.Size(34, 46),
                anchor: new window.google.maps.Point(17, 45)
              } : undefined;

              return (
                <React.Fragment key={`task_pin_frag_${t.id}_${tIdx}`}>
                  <MarkerF
                    position={pos}
                    icon={redPinIcon}
                    title={`${t.taskCategoryDescription}: ${t.description}`}
                    zIndex={isSelected ? 200 : 100}
                    onClick={() => {
                      setSelectedTaskId(isSelected ? null : t.id);
                      if (mapInstance) {
                        mapInstance.panTo(pos);
                      }
                    }}
                  />

                  {/* Android Style White Callout Box for Selected Task */}
                  {isSelected && (
                    <OverlayViewF
                      position={pos}
                      mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                      getPixelPositionOffset={(width, height) => ({
                        x: -(width / 2),
                        y: -(height + 48)
                      })}
                    >
                      <div style={{
                        width: 140,
                        height: 84,
                        backgroundColor: '#FFFFFF',
                        borderRadius: 8,
                        border: '1px solid #E0E0E0',
                        boxShadow: '0 4px 14px rgba(0,0,0,0.3)',
                        padding: '10px 12px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        boxSizing: 'border-box',
                        pointerEvents: 'auto',
                        zIndex: 99999
                      }}>
                        <div style={{
                          color: '#1B5E20',
                          fontSize: 15,
                          fontWeight: 700,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          lineHeight: '1.2'
                        }}>
                          {t.taskCategoryDescription}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (onNavigateToHomeTask) {
                              onNavigateToHomeTask(t.id);
                            }
                          }}
                          onTouchEnd={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (onNavigateToHomeTask) {
                              onNavigateToHomeTask(t.id);
                            }
                          }}
                          style={{
                            height: 26,
                            backgroundColor: '#FBC02D',
                            border: '1px solid #E5A900',
                            borderRadius: 6,
                            padding: '0 12px',
                            fontSize: 11,
                            fontWeight: 700,
                            color: '#222222',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            alignSelf: 'flex-start',
                            userSelect: 'none',
                            WebkitTapHighlightColor: 'transparent',
                            touchAction: 'manipulation'
                          }}
                        >
                          View Task
                        </button>
                      </div>
                    </OverlayViewF>
                  )}
                </React.Fragment>
              );
            })}
          </GoogleMap>
        )}

        {/* Top Left Floating Map Actions */}
        <div style={{
          position: 'absolute',
          top: 14,
          left: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          zIndex: 10
        }}>
          {/* Recenter Button */}
          <button
            onClick={() => {
              if (mapInstance && kmlBoundaryPoints.length > 0 && window.google) {
                window.google.maps.event.trigger(mapInstance, 'resize');
                const bounds = new window.google.maps.LatLngBounds();
                kmlBoundaryPoints.forEach((pt) => bounds.extend(pt));
                mapInstance.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });
              }
            }}
            style={{
              width: 36,
              height: 36,
              borderRadius: 4,
              backgroundColor: 'rgba(37, 37, 37, 0.63)',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFFFFF',
              cursor: 'pointer'
            }}
            title="Recenter Map"
          >
            <Crosshair size={20} />
          </button>

          {/* Map Type Switcher */}
          <button
            onClick={() => setMapType(mapType === 'satellite' ? 'hybrid' : mapType === 'hybrid' ? 'roadmap' : 'satellite')}
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              backgroundColor: 'rgba(37, 37, 37, 0.63)',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFFFFF',
              cursor: 'pointer'
            }}
            title="Toggle Map Style"
          >
            <Layers size={20} />
          </button>

          {/* Task View Button with Dual-Tone (#00AC22 to #1C5EF8) Gradient Border */}
          <div
            onClick={() => {
              setIsTaskViewActive(prev => !prev);
              if (isTaskViewActive) {
                setSelectedTaskId(null);
              }
            }}
            style={{
              padding: isTaskViewActive ? '2.5px' : '0px',
              borderRadius: 10,
              background: isTaskViewActive 
                ? 'linear-gradient(to right, #00AC22, #1C5EF8)' 
                : 'transparent',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s ease'
            }}
            title="Click to toggle Task Pins on map"
          >
            <div style={{
              padding: '4px 14px',
              borderRadius: isTaskViewActive ? 7.5 : 8,
              backgroundColor: '#FDED76',
              color: '#464646',
              fontSize: 12,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: 28,
              boxSizing: 'border-box'
            }}>
              Task View
            </div>
          </div>
        </div>

        {/* Dynamic Metric Legend Bar (Positioned in bottom-left corner near Google logo) */}
        {activeLayer !== 'SATELLITE' && activeLayer !== 'LANDSCAPE' && (
          <div style={{
            position: 'absolute',
            bottom: 24,
            left: 14,
            backgroundColor: 'rgba(37, 37, 37, 0.85)',
            backdropFilter: 'blur(8px)',
            borderRadius: 8,
            padding: '8px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            zIndex: 10,
            color: '#FFFFFF',
            fontSize: 11,
            fontWeight: 600,
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
          }}>
            {activeLayer === 'MOISTURE' ? (
              <>
                <span style={{ fontSize: 11, color: '#90CAF9', marginBottom: 2 }}>Moisture Legend</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: '#87CEEB' }} />
                  <span>Moist</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: '#00008B' }} />
                  <span>Flooded</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: '#808080' }} />
                  <span>Dry</span>
                </div>
              </>
            ) : (
              <>
                <span style={{ fontSize: 11, color: '#A5D6A7', marginBottom: 2 }}>Turf Health Legend</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: '#006400' }} />
                  <span>Healthy</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: '#FFFF00' }} />
                  <span>Moderate</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: '#D30000' }} />
                  <span>Stress</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Bottom mowing section cards (LANDSCAPE only): one card per section with data */}
        {activeLayer === 'LANDSCAPE' && mowingCards.length > 0 && (
          <div
            style={{
              position: 'absolute',
              bottom: 16,
              left: 0,
              right: 0,
              display: 'flex',
              alignItems: 'stretch',
              gap: 8,
              overflowX: 'auto',
              padding: '8px 12px',
              zIndex: 30,
              scrollbarWidth: 'none',
              msOverflowStyle: 'none'
            }}
          >
            {mowingCards.map((card) => (
              <div
                key={card.sectionId}
                onClick={() => {
                  setSelectedMowingSectionId(card.sectionId);
                  let points = kmlPolygons.get(card.sectionId);
                  if (!points || points.length === 0) {
                    const cardTitleLower = card.title.toLowerCase();
                    for (const [sid, pts] of kmlPolygons.entries()) {
                      const desc = getSectionDescription(sid);
                      if (getCanonicalParentCategory(desc).toLowerCase() === cardTitleLower) {
                        points = pts;
                        break;
                      }
                    }
                  }
                  if (points && points.length > 0 && mapInstance) {
                    const avgLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
                    const avgLng = points.reduce((s, p) => s + p.lng, 0) / points.length;
                    mapInstance.panTo({ lat: avgLat, lng: avgLng });
                    mapInstance.setZoom(18.5);
                  } else if (centroid && centroid.lat && mapInstance) {
                    mapInstance.panTo(centroid);
                    mapInstance.setZoom(18);
                  }
                }}
                style={{
                  flex: '1 1 0',
                  minWidth: 96,
                  maxWidth: 140,
                  backgroundColor: card.isSelected ? '#2E7D32' : '#388E3C',
                  border: card.isSelected ? '2px solid #FFFFFF' : 'none',
                  borderRadius: 12,
                  padding: 12,
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
                  flexShrink: 0,
                  boxSizing: 'border-box'
                }}
              >
                {/* 1. Title Row */}
                <span
                  style={{
                    color: '#FFFFFF',
                    fontWeight: 700,
                    fontSize: 14,
                    textAlign: 'center',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    width: '100%'
                  }}
                >
                  {card.title}
                </span>

                <div
                  style={{
                    width: '100%',
                    height: 1,
                    backgroundColor: 'rgba(255, 255, 255, 0.4)',
                    margin: '8px 0'
                  }}
                />

                {/* 2. Direction Rows: fills the middle so every card is the same height */}
                <div
                  style={{
                    flex: 1,
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                {card.directions.map((dirText, idx) => (
                  <React.Fragment key={idx}>
                    {idx > 0 && (
                      <div
                        style={{
                          width: '100%',
                          height: 1,
                          backgroundColor: 'rgba(255, 255, 255, 0.4)',
                          margin: '8px 0'
                        }}
                      />
                    )}
                    <span
                      style={{
                        color: '#FFFFFF',
                        fontWeight: 700,
                        fontSize: 16,
                        textAlign: 'center'
                      }}
                    >
                      {dirText}
                    </span>
                  </React.Fragment>
                ))}
                </div>

                <div
                  style={{
                    width: '100%',
                    height: 1,
                    backgroundColor: 'rgba(255, 255, 255, 0.4)',
                    margin: '8px 0'
                  }}
                />

                {/* 3. Scheduled Date Row */}
                <span
                  style={{
                    color: 'rgba(255, 255, 255, 0.9)',
                    fontSize: 12,
                    textAlign: 'center'
                  }}
                >
                  {card.date}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Sleek Top Progress Bar matching Android DynamicHoleView.kt line 1110 */}
        {(isLoadingGrid || isLoadingMowing) && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 3.5,
            backgroundColor: 'rgba(251, 192, 45, 0.25)',
            zIndex: 35,
            overflow: 'hidden'
          }}>
            <div className="indeterminate-progress-bar" style={{
              height: '100%',
              backgroundColor: '#FBC02D',
              width: '45%'
            }} />
          </div>
        )}

        {/* Lightweight Spinner ONLY if initial KML polygons are downloading and map is completely empty */}
        {isLoadingKml && kmlPolygons.size === 0 && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 25
          }}>
            <div style={{
              width: 38,
              height: 38,
              border: '3.5px solid rgba(251, 192, 45, 0.3)',
              borderTopColor: '#FBC02D',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite'
            }} />
          </div>
        )}

        {/* Android Calendar Modal for Landscape Mode */}
        {showLandscapeDatePicker && (
          <AndroidDatePickerDialog
            initialDate={landscapeSelectedDate}
            onDismiss={() => setShowLandscapeDatePicker(false)}
            onApply={(newDate) => {
              setLandscapeSelectedDate(newDate);
              setShowLandscapeDatePicker(false);
            }}
          />
        )}

      </div>
    </div>
  );
};
