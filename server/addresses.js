// Which addresses somebody can actually type in.
//
// Node reports a software-only adapter — WSL, Hyper-V, Docker, a VPN — exactly
// like a real network card, so the obvious "every non-internal IPv4" gives you
// 172.26.208.1 alongside the WiFi address. Nobody outside this laptop can reach
// it. In a list of ways to join, an address that cannot work is worse than no
// address at all: it is the one somebody tries first when the real one fails,
// and then they decide the studio is broken.
//
// This lives in one file because it was written twice — once in the launcher
// and once in the server — and only the launcher's copy got the filter. The
// server went on printing the WSL address, and handing it to the QR code.

import { networkInterfaces } from 'node:os';

/** Windows Mobile Hotspot always uses this range. */
export const HOTSPOT_RANGE = /^192\.168\.137\./;

/** Adapters that exist for software on this laptop and lead nowhere else. */
export const VIRTUAL =
  /^(vEthernet|WSL|Hyper-V|Docker|VirtualBox|VMware|Loopback|Bluetooth|Tailscale|ZeroTier|Npcap)/i;

/**
 * Every address a person in the room could join on, best one first.
 *
 * The hotspot leads, because when it is on it is the one that works for
 * everybody — phones join it directly instead of depending on whatever the
 * house router is doing.
 *
 * @returns {{ip:string, adapter:string, hotspot:boolean, what:string}[]}
 */
export function joinAddresses() {
  return Object.entries(networkInterfaces())
    .flatMap(([adapter, list]) => (list ?? []).map((n) => ({ ...n, adapter })))
    .filter((n) => n.family === 'IPv4' && !n.internal && !VIRTUAL.test(n.adapter))
    .map((n) => ({
      ip: n.address,
      adapter: n.adapter,
      hotspot: HOTSPOT_RANGE.test(n.address),
      // What to call it, in the words somebody would use out loud. The adapter
      // name is the fallback, because a made-up label would be worse than the
      // real one Windows chose.
      what: HOTSPOT_RANGE.test(n.address)
        ? 'your hotspot'
        : /wi-?fi|wlan|wireless/i.test(n.adapter)
          ? 'this WiFi'
          : /ethernet|lan/i.test(n.adapter)
            ? 'the cable'
            : n.adapter,
    }))
    .sort((a, b) => Number(b.hotspot) - Number(a.hotspot));
}
