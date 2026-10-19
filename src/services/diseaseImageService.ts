/**
 * Fetches real-time dynamic image URLs from AWS S3 for a given turf disease or pest.
 */
export async function fetchDiseaseImages(diseaseName: string): Promise<string[]> {
  if (!diseaseName || !diseaseName.trim()) return [];

  try {
    const res = await fetch(`/api/disease-images?disease=${encodeURIComponent(diseaseName.trim())}`);
    if (res.ok) {
      const data = await res.json();
      return Array.isArray(data.images) ? data.images : [];
    }
  } catch (err) {
    console.warn(`Failed to fetch dynamic disease gallery images for '${diseaseName}':`, err);
  }

  return [];
}
