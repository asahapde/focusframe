import type { DensityGrid } from "./api/types";

export type Grid = {
  width: number;
  height: number;
  /** Row-major, top-left origin; values[r * width + c]. */
  values: Float32Array;
};

function base64ToBytes(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Decode the API's base64 little-endian float32 grid (endianness-safe via DataView). */
export function decodeDensity(grid: DensityGrid): Grid {
  if (grid.encoding !== "base64-float32-le") {
    throw new Error(`Unsupported density encoding: ${grid.encoding}`);
  }
  const bytes = base64ToBytes(grid.data);
  const count = grid.width * grid.height;
  if (bytes.length !== count * 4) {
    throw new Error("Density grid length does not match its dimensions.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values = new Float32Array(count);
  for (let i = 0; i < count; i++) values[i] = view.getFloat32(i * 4, true);
  return { width: grid.width, height: grid.height, values };
}
