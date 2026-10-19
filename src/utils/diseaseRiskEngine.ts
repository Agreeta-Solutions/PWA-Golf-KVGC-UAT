export interface DiseaseCondition {
  name: string;
  minTemp: number;
  maxTemp: number;
  minHumidity: number;
  minSoilTemp: number;
  maxSoilTemp?: number;
  isPest?: boolean;
}

export interface DiseaseRiskItem {
  initial: string;
  name: string;
  probability: string;
  isHighRisk: boolean;
}

export const DISEASE_CONDITIONS: DiseaseCondition[] = [
  // Fungal / Diseases
  { name: 'Dollar Spot', minTemp: 15.0, maxTemp: 32.0, minHumidity: 70.0, minSoilTemp: 10.0 },
  { name: 'Brown Patch', minTemp: 18.0, maxTemp: 35.0, minHumidity: 80.0, minSoilTemp: 15.0 },
  { name: 'Pythium Blight', minTemp: 20.0, maxTemp: 36.0, minHumidity: 85.0, minSoilTemp: 20.0 },
  { name: 'Take-All Patch', minTemp: 10.0, maxTemp: 30.0, minHumidity: 70.0, minSoilTemp: 12.0 },
  { name: 'Anthracnose', minTemp: 15.0, maxTemp: 32.0, minHumidity: 70.0, minSoilTemp: 18.0 },
  { name: 'Snow mold', minTemp: 0.0, maxTemp: 12.0, minHumidity: 85.0, minSoilTemp: 0.0, maxSoilTemp: 8.0 },
  { name: 'Summer Patch', minTemp: 18.0, maxTemp: 35.0, minHumidity: 65.0, minSoilTemp: 18.0, maxSoilTemp: 21.0 },
  { name: 'Leaf Spot / Melting Out', minTemp: 20.0, maxTemp: 32.0, minHumidity: 75.0, minSoilTemp: 18.0 },
  { name: 'Red Thread', minTemp: 12.0, maxTemp: 25.0, minHumidity: 80.0, minSoilTemp: 8.0 },
  { name: 'Rust', minTemp: 10.0, maxTemp: 28.0, minHumidity: 70.0, minSoilTemp: 10.0 },
  { name: 'Gray Leaf Spot', minTemp: 22.0, maxTemp: 35.0, minHumidity: 80.0, minSoilTemp: 22.0 },
  { name: 'Spring Dead Spot', minTemp: 4.0, maxTemp: 21.0, minHumidity: 65.0, minSoilTemp: 0.0, maxSoilTemp: 21.0 },
  { name: 'Downy Mildew', minTemp: 4.0, maxTemp: 21.0, minHumidity: 75.0, minSoilTemp: 0.0, maxSoilTemp: 21.0 },
  { name: 'Superficial Fairy Ring', minTemp: 10.0, maxTemp: 30.0, minHumidity: 55.0, minSoilTemp: 13.0 },
  { name: 'Pythium Root Rot', minTemp: 10.0, maxTemp: 35.0, minHumidity: 70.0, minSoilTemp: 10.0 },

  // Pests
  { name: 'White Grub', minTemp: 18.0, maxTemp: 35.0, minHumidity: 60.0, minSoilTemp: 20.0, isPest: true },
  { name: 'Armyworm', minTemp: 18.0, maxTemp: 35.0, minHumidity: 60.0, minSoilTemp: 18.0, isPest: true },
  { name: 'Sod Webworm', minTemp: 20.0, maxTemp: 35.0, minHumidity: 60.0, minSoilTemp: 18.0, isPest: true },
  { name: 'Cutworm', minTemp: 12.0, maxTemp: 32.0, minHumidity: 55.0, minSoilTemp: 12.0, isPest: true },
  { name: 'Mole Cricket', minTemp: 18.0, maxTemp: 35.0, minHumidity: 60.0, minSoilTemp: 20.0, isPest: true },
  { name: 'Billbug', minTemp: 15.0, maxTemp: 35.0, minHumidity: 55.0, minSoilTemp: 18.0, isPest: true },
  { name: 'Chinch Bug', minTemp: 25.0, maxTemp: 38.0, minHumidity: 65.0, minSoilTemp: 28.0, isPest: true },
  { name: 'Aphids (Greenbug)', minTemp: 10.0, maxTemp: 28.0, minHumidity: 65.0, minSoilTemp: 10.0, isPest: true },
  { name: 'Bermudagrass Mite', minTemp: 25.0, maxTemp: 40.0, minHumidity: 40.0, minSoilTemp: 28.0, isPest: true },
  { name: 'Nematodes', minTemp: 15.0, maxTemp: 35.0, minHumidity: 50.0, minSoilTemp: 15.0, isPest: true },
  { name: 'Annual Bluegrass Weevil', minTemp: 10.0, maxTemp: 32.0, minHumidity: 55.0, minSoilTemp: 12.0, isPest: true }
];

export interface DailyRiskInputs {
  /** 24 h average of hourly temperature_2m (°C) */
  temp: number;
  /** 24 h average of hourly relative_humidity_2m (%) */
  humidity: number;
  /** 24 h average of hourly soil_temperature_6cm (°C) */
  soilTemp: number;
}

interface HourlySeries {
  time: string[];
  temperature_2m?: (number | null)[];
  relative_humidity_2m?: (number | null)[];
  soil_temperature_6cm?: (number | null)[];
}

function averageOf(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return valid.length > 0 ? valid.reduce((sum, v) => sum + v, 0) / valid.length : null;
}

/**
 * 24-hour averages used for pest & disease risk, from the hourly Open-Meteo series for one
 * calendar day (course-local, `YYYY-MM-DD`):
 *   temp     = avg(valid hourly temperature_2m)
 *   humidity = avg(valid hourly relative_humidity_2m)
 *   soilTemp = avg(valid hourly soil_temperature_6cm)
 * Missing / null hours are skipped. Returns null for any value with no valid hours that day.
 */
export function dailyAverages(
  hourly: HourlySeries | undefined,
  date: string
): { temp: number | null; humidity: number | null; soilTemp: number | null } {
  const empty = { temp: null, humidity: null, soilTemp: null };
  if (!hourly?.time?.length || !date) return empty;

  const idx: number[] = [];
  hourly.time.forEach((t, i) => {
    if (t.startsWith(date)) idx.push(i);
  });
  if (idx.length === 0) return empty;

  const pick = (series?: (number | null)[]) => idx.map(i => series?.[i]);
  return {
    temp: averageOf(pick(hourly.temperature_2m)),
    humidity: averageOf(pick(hourly.relative_humidity_2m)),
    soilTemp: averageOf(pick(hourly.soil_temperature_6cm))
  };
}

/**
 * Evaluates weather metrics against conditions.
 * Rule: if 2 or more conditions match -> High Risk, else Low Risk.
 */
export function evaluateRisks(temp: number, humidity: number, soilTemp: number): DiseaseRiskItem[] {
  return DISEASE_CONDITIONS.map(condition => {
    let matchedCount = 0;

    // Condition 1: Humidity Check
    if (humidity >= condition.minHumidity) {
      matchedCount++;
    }

    // Condition 2: Temperature Range Check
    if (temp >= condition.minTemp && temp <= condition.maxTemp) {
      matchedCount++;
    }

    // Condition 3: Soil Temp Check
    const maxSoil = condition.maxSoilTemp !== undefined ? condition.maxSoilTemp : Number.MAX_VALUE;
    if (soilTemp >= condition.minSoilTemp && soilTemp <= maxSoil) {
      matchedCount++;
    }

    const isHighRisk = matchedCount >= 2;

    return {
      initial: condition.name.charAt(0).toUpperCase(),
      name: condition.name,
      probability: isHighRisk ? 'High Probability' : 'Low Probability',
      isHighRisk
    };
  });
}
