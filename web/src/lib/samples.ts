import manifest from "@/data/samples.json";

export type SampleRegion = {
  label: string;
  name: string;
  rect: { x: number; y: number; width: number; height: number };
};

export type Sample = {
  id: string;
  title: string;
  src: string;
  filename: string;
  width: number;
  height: number;
  regions: SampleRegion[];
};

export const SAMPLES: Sample[] = manifest.samples;

export async function fetchSampleBlob(sample: Sample): Promise<Blob> {
  const response = await fetch(sample.src);
  if (!response.ok) {
    throw new Error(`Could not load sample image (HTTP ${response.status}).`);
  }
  return response.blob();
}
