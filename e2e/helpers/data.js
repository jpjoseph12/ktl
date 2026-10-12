/* These tests run against a throwaway server (scripts/e2e-server.mjs),
 * but each spec still cleans up after itself, so a run against a server
 * you keep around doesn't accumulate test data:
 *
 *   1. Every name a test creates gets an "E2E" tag and a run-scoped
 *      suffix, so two runs (or a flaky rerun) never collide on a name.
 *   2. Specs that create something delete it again once they've asserted
 *      what they needed to — see each spec's `after` hook.
 */
const RUN_ID = Date.now().toString(36);

export function uniqueName(label) {
  return `E2E ${label} ${RUN_ID}-${Math.random().toString(36).slice(2, 6)}`;
}
