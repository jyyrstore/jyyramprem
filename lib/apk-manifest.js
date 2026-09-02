import zlib from "node:zlib";

const ANDROID_NS = "http://schemas.android.com/apk/res/android";
const UTF8_FLAG = 0x100;
const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;

function u16(buf, off) { return buf.readUInt16LE(off); }
function u32(buf, off) { return buf.readUInt32LE(off); }
function readUtf8Length(buf, off) {
  const a = buf[off++];
  if (a & 0x80) return { length: ((a & 0x7f) << 8) | buf[off++], offset: off };
  return { length: a, offset: off };
}

function readStringPool(buf, chunkOffset) {
  const headerSize = u16(buf, chunkOffset + 2);
  const stringCount = u32(buf, chunkOffset + 8);
  const flags = u32(buf, chunkOffset + 16);
  const stringsStart = u32(buf, chunkOffset + 20);
  const offsetsBase = chunkOffset + headerSize;
  const stringsBase = chunkOffset + stringsStart;
  const strings = new Array(stringCount);
  for (let i = 0; i < stringCount; i += 1) {
    let p = stringsBase + u32(buf, offsetsBase + i * 4);
    if (flags & UTF8_FLAG) {
      let r = readUtf8Length(buf, p); p = r.offset;
      r = readUtf8Length(buf, p); p = r.offset;
      strings[i] = buf.subarray(p, p + r.length).toString("utf8");
    } else {
      const length = u16(buf, p); p += 2;
      strings[i] = buf.subarray(p, p + length * 2).toString("utf16le");
    }
  }
  return strings;
}

function decodeTypedValue(strings, type, data) {
  if (type === TYPE_STRING) return strings[data] ?? null;
  if (type === TYPE_INT_DEC || type === TYPE_INT_HEX) return data >>> 0;
  return data >>> 0;
}

export function parseAndroidManifest(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < 8 || u16(buf, 0) !== 0x0003) throw new Error("AndroidManifest.xml bukan binary XML Android yang valid.");
  const totalSize = u32(buf, 4);
  if (totalSize > buf.length || totalSize < 8) throw new Error("AndroidManifest.xml rusak atau terpotong.");
  let strings = [];
  let packageName = null;
  let versionName = null;
  let versionCode = null;
  let minSdk = null;
  let targetSdk = null;
  let applicationFound = false;

  for (let pos = 8; pos + 8 <= totalSize;) {
    const type = u16(buf, pos);
    const headerSize = u16(buf, pos + 2);
    const size = u32(buf, pos + 4);
    if (headerSize < 8 || size < headerSize || pos + size > totalSize) throw new Error("Chunk AndroidManifest.xml tidak valid.");

    if (type === 0x0001) {
      strings = readStringPool(buf, pos);
    } else if (type === 0x0102) {
      const nsIdx = u32(buf, pos + 16);
      const nameIdx = u32(buf, pos + 20);
      const attrStart = u16(buf, pos + 24);
      const attrSize = u16(buf, pos + 26);
      const attrCount = u16(buf, pos + 28);
      const name = strings[nameIdx] || "";
      const base = pos + 16 + attrStart;
      for (let i = 0; i < attrCount; i += 1) {
        const a = base + i * attrSize;
        if (a + 20 > pos + size) throw new Error("Attribute AndroidManifest.xml tidak valid.");
        const attrNs = u32(buf, a);
        const attrNameIdx = u32(buf, a + 4);
        const rawValue = u32(buf, a + 8);
        const valueType = u16(buf, a + 15);
        const valueData = u32(buf, a + 16);
        const attrName = strings[attrNameIdx] || "";
        const value = rawValue !== 0xffffffff ? (strings[rawValue] ?? null) : decodeTypedValue(strings, valueType, valueData);
        const isAndroid = attrNs < strings.length && strings[attrNs] === ANDROID_NS;
        if (name === "manifest" && attrName === "package" && !packageName) packageName = String(value || "");
        if (name === "manifest" && isAndroid && attrName === "versionName") versionName = String(value ?? "");
        if (name === "manifest" && isAndroid && attrName === "versionCode") versionCode = Number(value);
        if (name === "uses-sdk" && isAndroid && attrName === "minSdkVersion") minSdk = Number(value);
        if (name === "uses-sdk" && isAndroid && attrName === "targetSdkVersion") targetSdk = Number(value);
      }
      if (name === "application") applicationFound = true;
    }
    pos += size;
  }

  if (!packageName) throw new Error("Package Name tidak ditemukan di AndroidManifest.xml.");
  if (!versionName) throw new Error("versionName tidak ditemukan di AndroidManifest.xml.");
  if (!Number.isInteger(versionCode) || versionCode < 1) throw new Error("versionCode tidak valid di AndroidManifest.xml.");
  if (!Number.isInteger(minSdk) || minSdk < 1) throw new Error("minSdkVersion tidak ditemukan atau tidak valid.");
  if (!Number.isInteger(targetSdk) || targetSdk < 1) throw new Error("targetSdkVersion tidak ditemukan atau tidak valid.");
  return { packageName, versionName, versionCode, minSdk, targetSdk, applicationFound };
}

function findZipEntry(buf, target) {
  const eocdSig = 0x06054b50;
  const cdirSig = 0x02014b50;
  const localSig = 0x04034b50;
  const min = Math.max(0, buf.length - 0x10000 - 22);
  let eocd = -1;
  for (let p = buf.length - 22; p >= min; p -= 1) {
    if (buf.readUInt32LE(p) === eocdSig) { eocd = p; break; }
  }
  if (eocd < 0) throw new Error("APK ZIP central directory tidak ditemukan.");
  const count = u16(buf, eocd + 10);
  const dirSize = u32(buf, eocd + 12);
  const dirOffset = u32(buf, eocd + 16);
  if (dirOffset + dirSize > buf.length) throw new Error("APK ZIP central directory rusak.");
  let p = dirOffset;
  for (let i = 0; i < count; i += 1) {
    if (p + 46 > buf.length || u32(buf, p) !== cdirSig) throw new Error("APK ZIP entry tidak valid.");
    const compression = u16(buf, p + 10);
    const compressedSize = u32(buf, p + 20);
    const uncompressedSize = u32(buf, p + 24);
    const nameLen = u16(buf, p + 28);
    const extraLen = u16(buf, p + 30);
    const commentLen = u16(buf, p + 32);
    const localOffset = u32(buf, p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    if (name === target) {
      if (localOffset + 30 > buf.length || u32(buf, localOffset) !== localSig) throw new Error("APK local ZIP entry rusak.");
      const localNameLen = u16(buf, localOffset + 26);
      const localExtraLen = u16(buf, localOffset + 28);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const compressed = buf.subarray(dataStart, dataStart + compressedSize);
      if (compression === 0) return Buffer.from(compressed);
      if (compression === 8) return zlib.inflateRawSync(compressed, { maxOutputLength: Math.max(uncompressedSize, 1024) });
      throw new Error(`AndroidManifest.xml menggunakan metode ZIP ${compression} yang tidak didukung.`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error("AndroidManifest.xml tidak ditemukan di APK.");
}

export function extractAndroidManifestFromApk(buffer) {
  return findZipEntry(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer), "AndroidManifest.xml");
}

export function inspectApk(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error("File bukan APK/ZIP yang valid.");
  return parseAndroidManifest(extractAndroidManifestFromApk(buf));
}
