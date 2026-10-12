# Contributing to KTL

Thanks for helping. A few things keep KTL what it is:

- **The privacy wall.** Nothing in Yours (pay, personal bills, debts,
  savings, spending reviews) may ever reach the household side, or reveal
  that it exists. Exactly one number crosses the wall, inwards: your share
  of the household bills. Changes that touch private data need tests that
  show the wall still holds, including row-level security in
  `db/tests`.
- **Self-hosted first.** Everything should work on a single server with no
  outside services. Email, push and tunnels stay optional.
- **Plain English.** Copy in the app explains what happens and why, in
  British English and pounds, without jargon.

## Getting set up

See **Development** in the [README](README.md). Before opening a pull request:

```bash
npm test
npm run build
cd selfhost/gateway && npm test
```

- **Database changes** go in a new file in `db/migrations/`. Never edit
  one that has been released, because servers that already ran it won't
  run it again.
- **Bugs:** open an issue with steps to reproduce, and the server log
  (`docker logs ktl`) if it's server-side. Remove anything personal from
  logs first.

By contributing you agree that your contributions are licensed under the
[AGPL-3.0](LICENSE).
