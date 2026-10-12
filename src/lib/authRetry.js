/* A token can be momentarily unusable without anything being wrong: "JWT
   issued at future" is a few seconds of clock skew between the service
   that mints tokens and the one that checks them, and an expired token
   just needs refreshing. Both fix themselves, so treating either as a
   real failure — stranding someone on an error screen, or (worse, since
   nothing prompts a retry on its own) silently showing empty defaults
   forever — is the wrong answer.

   Shared by KettleContext and PrivateContext's boot effects, which each
   wrap this in their own retry loop (they differ in how they detect a
   superseded boot, which doesn't factor out cleanly) — kept here as the
   one place that decides what counts as recoverable, so the two can't
   silently drift apart on that question. */
export function isRecoverableAuthError(err) {
  const m = (err?.message || '').toLowerCase();
  return m.includes('jwt') || m.includes('issued at') || m.includes('token') || m.includes('expired');
}
