import rawAdvisories from '../data/advisory_data.json';

export interface AdvisoryItem {
  name: string;
  category?: string;
  irrigation?: string;
  fertilization?: string;
  mowing?: string;
  cultural?: string;
  chemicalOptions?: string;
  prevention?: string;
}

const advisoryCache: AdvisoryItem[] = rawAdvisories as AdvisoryItem[];

/**
 * Normalizes a disease/pest name for fuzzy matching, exactly like Android AdvisoryAssetLoader.kt.
 */
function normalizeName(str: string): string {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Retrieves the agronomic advisory record for a disease or pest name.
 */
export function getAdvisoryByName(diseaseName: string): AdvisoryItem | null {
  const target = normalizeName(diseaseName);
  if (!target) return null;

  return (
    advisoryCache.find(item => {
      const itemName = normalizeName(item.name || '');
      return itemName === target || itemName.includes(target) || target.includes(itemName);
    }) || null
  );
}

