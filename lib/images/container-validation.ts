import { ImagePipelineError } from "./errors";
import type { SupportedImageMimeType } from "./types";

function malformed(): never {
  throw new ImagePipelineError("malformed_image");
}

function animated(): never {
  throw new ImagePipelineError("animated_image");
}

function validatePng(bytes: Buffer): void {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 20 || !bytes.subarray(0, 8).equals(signature)) {
    malformed();
  }

  let offset = 8;
  let sawHeader = false;
  let sawEnd = false;

  while (offset < bytes.length) {
    if (bytes.length - offset < 12) {
      malformed();
    }

    const dataLength = bytes.readUInt32BE(offset);
    const chunkEnd = offset + 12 + dataLength;
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > bytes.length) {
      malformed();
    }

    const chunkType = bytes.toString("ascii", offset + 4, offset + 8);
    if (!sawHeader) {
      if (chunkType !== "IHDR" || dataLength !== 13) {
        malformed();
      }
      sawHeader = true;
    } else if (chunkType === "IHDR") {
      malformed();
    }

    if (chunkType === "acTL" || chunkType === "fcTL" || chunkType === "fdAT") {
      animated();
    }

    offset = chunkEnd;
    if (chunkType === "IEND") {
      if (dataLength !== 0 || offset !== bytes.length) {
        malformed();
      }
      sawEnd = true;
      break;
    }
  }

  if (!sawHeader || !sawEnd || offset !== bytes.length) {
    malformed();
  }
}

function validateWebp(bytes: Buffer): void {
  if (
    bytes.length < 20 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WEBP"
  ) {
    malformed();
  }

  const declaredLength = bytes.readUInt32LE(4) + 8;
  if (declaredLength !== bytes.length) {
    malformed();
  }

  let offset = 12;
  let imagePayloads = 0;

  while (offset < bytes.length) {
    if (bytes.length - offset < 8) {
      malformed();
    }

    const chunkType = bytes.toString("ascii", offset, offset + 4);
    const dataLength = bytes.readUInt32LE(offset + 4);
    const paddedLength = dataLength + (dataLength % 2);
    const chunkEnd = offset + 8 + paddedLength;
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > bytes.length) {
      malformed();
    }

    if (chunkType === "ANIM" || chunkType === "ANMF") {
      animated();
    }

    if (chunkType === "VP8X") {
      if (dataLength !== 10) {
        malformed();
      }
      const featureFlags = bytes[offset + 8];
      if ((featureFlags & 0x02) !== 0) {
        animated();
      }
    }

    if (chunkType === "VP8 " || chunkType === "VP8L") {
      imagePayloads += 1;
    }

    offset = chunkEnd;
  }

  if (offset !== bytes.length || imagePayloads !== 1) {
    malformed();
  }
}

function isStandaloneJpegMarker(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
}

/**
 * Finds the real JPEG end marker while respecting byte stuffing inside scans.
 * Requiring it to be the final byte rejects concatenated images and appended
 * polyglot payloads that decoders would otherwise silently ignore.
 */
function validateJpeg(bytes: Buffer): void {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    malformed();
  }

  let offset = 2;
  let inScan = false;

  while (offset < bytes.length) {
    if (inScan) {
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }

        const markerStart = offset;
        while (offset < bytes.length && bytes[offset] === 0xff) {
          offset += 1;
        }
        if (offset >= bytes.length) {
          malformed();
        }

        const marker = bytes[offset];
        if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
          offset += 1;
          continue;
        }

        offset = markerStart;
        inScan = false;
        break;
      }
      if (inScan) {
        malformed();
      }
    }

    if (bytes[offset] !== 0xff) {
      malformed();
    }
    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset += 1;
    }
    if (offset >= bytes.length) {
      malformed();
    }

    const marker = bytes[offset];
    offset += 1;

    if (marker === 0xd9) {
      if (offset !== bytes.length) {
        malformed();
      }
      return;
    }

    if (marker === 0xd8 || marker === 0x00) {
      malformed();
    }
    if (isStandaloneJpegMarker(marker)) {
      continue;
    }

    if (bytes.length - offset < 2) {
      malformed();
    }
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      malformed();
    }
    offset += segmentLength;

    if (marker === 0xda) {
      inScan = true;
    }
  }

  malformed();
}

export function validateImageContainer(
  bytes: Buffer,
  mimeType: SupportedImageMimeType,
): void {
  switch (mimeType) {
    case "image/jpeg":
      validateJpeg(bytes);
      return;
    case "image/png":
      validatePng(bytes);
      return;
    case "image/webp":
      validateWebp(bytes);
  }
}

