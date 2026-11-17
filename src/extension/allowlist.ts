// The sites where heyo may send a click on.
//
// A site belongs here only while its replay test passes: the scripted near
// miss in e2e/live/<host>.spec.ts makes the intended action happen exactly
// once. A unit test fails if an entry has no such test file. `tested` is the
// last day that test passed.
export interface AllowedSite {
  host: string;
  tested: string;
}

export const ALLOWLIST: AllowedSite[] = [];

/** True when retargeting may act on a page of this site. */
export function isAllowed(site: string, hosts: readonly string[]): boolean {
  return hosts.includes(site);
}
