import { ACCEPTED_MIME_TYPES, MAX_UPLOAD_BYTES } from "./config";

/**
 * Basic client-side checks so obvious mistakes fail fast. The API decodes and
 * validates the actual file content; this is only a convenience.
 */
export function checkFileBeforeUpload(file: { type: string; size: number }): string | null {
  if (!(ACCEPTED_MIME_TYPES as readonly string[]).includes(file.type)) {
    return "Only PNG and JPEG images are supported.";
  }
  if (file.size === 0) {
    return "The selected file is empty.";
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    const mib = (file.size / (1024 * 1024)).toFixed(1);
    return `The file is ${mib} MiB; the limit is 10 MiB.`;
  }
  return null;
}
