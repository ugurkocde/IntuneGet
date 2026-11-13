import { describe, expect, it } from 'vitest';
import { isPublicIpAddress } from './public-address';

describe('isPublicIpAddress', () => {
  it.each([
    ['loopback', '127.0.0.1'],
    ['loopback range', '127.255.255.254'],
    ['unspecified', '0.0.0.0'],
    ['private 10/8', '10.0.0.10'],
    ['private 172.16/12 start', '172.16.0.1'],
    ['private 172.16/12 end', '172.31.255.255'],
    ['private 192.168/16', '192.168.1.1'],
    ['link-local metadata', '169.254.169.254'],
    ['carrier grade NAT start', '100.64.0.1'],
    ['carrier grade NAT end', '100.127.255.255'],
    ['benchmarking', '198.18.0.1'],
    ['multicast', '224.0.0.1'],
    ['broadcast', '255.255.255.255'],
  ])('refuses IPv4 %s (%s)', (_label, address) => {
    expect(isPublicIpAddress(address)).toBe(false);
  });

  it.each([
    ['loopback', '::1'],
    ['unspecified', '::'],
    ['unique local fc00::/7 (fc)', 'fc00::1'],
    ['unique local fc00::/7 (fd)', 'fd12:3456:789a::1'],
    ['link-local fe80::/10 start', 'fe80::1'],
    ['link-local fe80::/10 end', 'febf::1'],
    ['link-local with zone', 'fe80::1%eth0'],
    ['site-local', 'fec0::1'],
    ['multicast', 'ff02::1'],
    ['mapped loopback, dotted', '::ffff:127.0.0.1'],
    ['mapped private, dotted', '::ffff:10.0.0.1'],
    ['mapped private, hex', '::ffff:a00:1'],
    ['mapped loopback, hex', '::ffff:7f00:1'],
    ['mapped metadata, hex', '::ffff:a9fe:a9fe'],
    ['mapped private, fully expanded', '0:0:0:0:0:ffff:c0a8:101'],
    ['IPv4-compatible loopback', '::7f00:1'],
    ['NAT64 of a private address', '64:ff9b::a00:1'],
    ['6to4', '2002:a00:1::1'],
    ['Teredo', '2001:0:4136:e378:8000:63bf:3fff:fdd2'],
    ['documentation', '2001:db8::1'],
    ['discard only', '100::1'],
  ])('refuses IPv6 %s (%s)', (_label, address) => {
    expect(isPublicIpAddress(address)).toBe(false);
  });

  it.each([
    ['8.8.8.8'],
    ['1.1.1.1'],
    ['172.15.255.255'],
    ['172.32.0.1'],
    ['100.63.255.255'],
    ['100.128.0.1'],
    ['169.253.1.1'],
    ['2606:4700:4700::1111'],
    ['2001:4860:4860::8888'],
    ['2A00:1450:4001:81B::200E'],
    ['::ffff:8.8.8.8'],
    ['::ffff:808:808'],
    ['64:ff9b::808:808'],
  ])('accepts public address %s', (address) => {
    expect(isPublicIpAddress(address)).toBe(true);
  });

  it.each([
    ['a hostname', 'example.com'],
    ['a bracketed literal', '[::1]'],
    ['a short IPv4 form', '127.1'],
    ['an out of range octet', '256.1.1.1'],
    ['an empty string', ''],
  ])('treats %s as not public', (_label, value) => {
    expect(isPublicIpAddress(value)).toBe(false);
  });
});
