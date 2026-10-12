# Security

KTL holds people's financial details, so security reports are very
welcome.

**Please don't open a public issue for a vulnerability.** Report it
privately through GitHub's **Security → Report a vulnerability** on this
repository. Include what you found, how to reproduce it, and what it
exposes. You'll get an answer as soon as possible, and credit if you'd
like it once a fix is out.

Particularly in scope:
- anything that lets one person see another's private data (Yours), or
  learn that it exists;
- reaching household data without being in the household;
- the setup and admin pages, and the server's own API (`/api/*`);
- the container: secrets in `/data`, the services it runs, what it exposes
  on port 3000.

## Running your server safely

- Put it behind HTTPS (a reverse proxy or a Cloudflare Tunnel) before
  using it away from home.
- Keep sign-ups closed unless you need them open, and add people from the
  admin page instead.
- Keep `/data/backups` somewhere safe. It holds everything, including
  password hashes.
- Rebuild the image now and then for upstream security fixes.
