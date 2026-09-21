import { describe, it, expect } from "vitest";
import {
  MAX_FILE_BYTES,
  checkUpload,
  formatBytes,
  isAllowedImageType,
  safeFileName,
  sniffImageType,
} from "./types";

/** Minimal byte sequences carrying each format's real magic number. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const GIF89 = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);
const GIF87 = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0, 0]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

describe("sniffImageType", () => {
  it("recognises the formats a mail client can render", () => {
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
    expect(sniffImageType(GIF89)).toBe("image/gif");
    expect(sniffImageType(GIF87)).toBe("image/gif");
    expect(sniffImageType(WEBP)).toBe("image/webp");
  });

  it("refuses SVG, however it is dressed up", () => {
    // SVG is a document format that executes script, served from our own
    // origin. It is excluded on purpose, not by oversight.
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    expect(sniffImageType(svg)).toBeNull();
    expect(isAllowedImageType("image/svg+xml")).toBe(false);
  });

  it("refuses HTML", () => {
    const html = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");
    expect(sniffImageType(html)).toBeNull();
  });

  it("is not fooled by a truncated header", () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50]))).toBeNull();
    expect(sniffImageType(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });

  it("reads a RIFF container that is not WebP as nothing", () => {
    // RIFF also wraps .wav — the WEBP tag at offset 8 is what matters.
    const wav = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45,
    ]);
    expect(sniffImageType(wav)).toBeNull();
  });
});

describe("checkUpload", () => {
  it("accepts a real image and names its type from the bytes", () => {
    const result = checkUpload({ name: "logo.png", bytes: PNG });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contentType).toBe("image/png");
  });

  it("believes the bytes, not the filename", () => {
    // A .png that is really a script must not be stored as an image and
    // later served from our origin with that Content-Type.
    const disguised = new TextEncoder().encode("<script>alert(1)</script>");
    const result = checkUpload({ name: "totally-an.png", bytes: disguised });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/SVG is deliberately not accepted|not a PNG/);
  });

  it("rejects an oversized file and says what to do", () => {
    const big = new Uint8Array(MAX_FILE_BYTES + 1);
    big.set(PNG.slice(0, 8));
    const result = checkUpload({ name: "huge.png", bytes: big });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/2 MB/);
    expect(result.error).toMatch(/resize/);
  });

  it("accepts a file exactly at the limit", () => {
    const exact = new Uint8Array(MAX_FILE_BYTES);
    exact.set(PNG.slice(0, 8));
    expect(checkUpload({ name: "edge.png", bytes: exact }).ok).toBe(true);
  });

  it("rejects an empty file", () => {
    const result = checkUpload({ name: "nothing.png", bytes: new Uint8Array() });
    expect(result.ok).toBe(false);
  });
});

describe("safeFileName", () => {
  it("strips a path, keeping only the name", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("C:\\Users\\me\\logo.png")).toBe("logo.png");
  });

  it("removes what would break a header", () => {
    // The name reaches a Content-Disposition header.
    expect(safeFileName('a"b.png')).toBe("ab.png");
    expect(safeFileName("line\r\nbreak.png")).toBe("linebreak.png");
    expect(safeFileName("null\u0000byte.png")).toBe("nullbyte.png");
  });

  it("never returns an empty name", () => {
    expect(safeFileName("")).toBe("image");
    expect(safeFileName('"""')).toBe("image");
  });

  it("caps a runaway name", () => {
    expect(safeFileName("x".repeat(500)).length).toBe(120);
  });
});

describe("formatBytes", () => {
  it("reads naturally at each scale", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1_572_864)).toBe("1.5 MB");
  });
});
