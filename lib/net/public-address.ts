/**
 * Public address classification
 * Shared by every server-side request whose destination comes from outside
 * the deployment (installer downloads, webhook deliveries). An address is
 * public only when it is a globally routable unicast address.
 */

import { isIP } from 'node:net';

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** Expand a textual IPv6 address into its eight 16 bit groups. */
function expandIpv6(address: string): number[] | null {
  let text = address;
  const dotted = text.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    if ([a, b, c, d].some((part) => part > 255)) return null;
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;

  const groups = [...head, ...new Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail]
    .map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : NaN));
  return groups.length === 8 && groups.every((group) => Number.isInteger(group)) ? groups : null;
}

function embeddedIpv4(groups: number[]): string {
  return `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
}

function isPublicIpv6(groups: number[]): boolean {
  const leadingZeros = groups.slice(0, 5).every((group) => group === 0);

  // IPv4-mapped (::ffff:a.b.c.d, also written ::ffff:hhhh:hhhh): the socket
  // connects to the embedded IPv4 address, so that address decides.
  if (leadingZeros && groups[5] === 0xffff) return !isPrivateIpv4(embeddedIpv4(groups));

  // NAT64 well-known prefix 64:ff9b::/96 also carries an IPv4 destination.
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((group) => group === 0)) {
    return !isPrivateIpv4(embeddedIpv4(groups));
  }

  // Global unicast is 2000::/3. Everything outside it is loopback,
  // unspecified, unique local (fc00::/7), link-local (fe80::/10), site-local,
  // multicast or otherwise reserved.
  if ((groups[0] & 0xe000) !== 0x2000) return false;

  // Reserved blocks inside 2000::/3: IETF protocol assignments such as Teredo
  // (2001::/23), documentation (2001:db8::/32 and 3fff::/20) and 6to4
  // (2002::/16), which tunnels to an embedded IPv4 address.
  if (groups[0] === 0x2001 && (groups[1] < 0x200 || groups[1] === 0xdb8)) return false;
  if (groups[0] === 0x2002) return false;
  if (groups[0] === 0x3fff && groups[1] < 0x1000) return false;

  return true;
}

/**
 * True for link-local addresses: 169.254.0.0/16 (which holds the cloud
 * metadata endpoints) and fe80::/10, also when written as IPv4-mapped IPv6.
 * These are never a legitimate destination, not even for installations that
 * allow destinations on their own network.
 */
export function isLinkLocalAddress(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0];
  const family = isIP(normalized);
  if (family === 4) return normalized.startsWith('169.254.');
  if (family !== 6) return false;

  const groups = expandIpv6(normalized);
  if (groups === null) return false;
  if ((groups[0] & 0xffc0) === 0xfe80) return true;
  const mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  return mapped && embeddedIpv4(groups).startsWith('169.254.');
}

/**
 * True only for a literal IPv4 or IPv6 address that is publicly routable.
 * Anything that is not a valid address literal is treated as not public.
 * IPv6 literals are accepted with or without a zone suffix, never in brackets.
 */
export function isPublicIpAddress(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0];
  const family = isIP(normalized);
  if (family === 4) return !isPrivateIpv4(normalized);
  if (family !== 6) return false;

  const groups = expandIpv6(normalized);
  return groups !== null && isPublicIpv6(groups);
}
