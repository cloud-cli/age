import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    const c = Number(address.split(".")[2]);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }

  const value = address.toLowerCase().split("%")[0];
  const ipv6 = parseIpv6Words(value);
  if (!ipv6) {
    return true;
  }
  const allZero = (words: number[]) => words.every((word) => word === 0);
  const mapped = allZero(ipv6.slice(0, 5)) && ipv6[5] === 0xffff;
  const translatable = allZero(ipv6.slice(0, 4)) && ipv6[4] === 0xffff && ipv6[5] === 0;
  if (mapped || translatable) {
    const embeddedIpv4 = `${ipv6[6] >> 8}.${ipv6[6] & 255}.${ipv6[7] >> 8}.${ipv6[7] & 255}`;
    return isPrivateAddress(embeddedIpv4);
  }
  if (allZero(ipv6.slice(0, 6))) {
    return true;
  }

  const globalUnicast = (ipv6[0] & 0xe000) === 0x2000;
  const specialPurpose =
    (ipv6[0] === 0x2001 && ipv6[1] <= 0x01ff) || (ipv6[0] === 0x2001 && ipv6[1] === 0x0db8) || ipv6[0] === 0x2002;
  return !globalUnicast || specialPurpose;
}

function parseIpv6Words(address: string) {
  let value = address;
  if (value.includes(".")) {
    const separator = value.lastIndexOf(":");
    const octets = value
      .slice(separator + 1)
      .split(".")
      .map(Number);
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
      return null;
    }
    const first = ((octets[0] << 8) | octets[1]).toString(16);
    const second = ((octets[2] << 8) | octets[3]).toString(16);
    value = `${value.slice(0, separator + 1)}${first}:${second}`;
  }

  const halves = value.split("::");
  if (halves.length > 2) {
    return null;
  }
  const left = halves[0] ? halves[0].split(":").map((word) => Number.parseInt(word, 16)) : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":").map((word) => Number.parseInt(word, 16)) : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) {
    return null;
  }
  const words = [...left, ...Array(missing).fill(0), ...right];
  return words.length === 8 && words.every((word) => Number.isInteger(word) && word >= 0 && word <= 0xffff)
    ? words
    : null;
}

export async function resolvePublicHost(hostname: string) {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local")) {
    throw new Error("Private network destinations are not allowed");
  }
  const addresses = isIP(normalized)
    ? [{ address: normalized, family: isIP(normalized) }]
    : await lookup(normalized, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("Private network destinations are not allowed");
  }
  return addresses;
}
