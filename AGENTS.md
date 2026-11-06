# Croot: notes for anyone changing this repository

## Versioning

Every commit that changes the application or its repository content increases the version in
`package.json` and both root-package version entries in `package-lock.json` (`version` and
`packages[""].version`), in the same commit as the change. Use semantic versioning:

- **patch** (1.0.0 → 1.0.1) for fixes and small changes, the usual case;
- **minor** (1.0.x → 1.1.0) for a new feature people will notice;
- **major** only for a breaking change to how organisers or guests use Croot.

End the commit title with the new version in brackets, e.g.
`Album: approve several photos at once (v1.0.4)`, so `git log --oneline` reads as a release history.

`npm version patch --no-git-tag-version` updates both files.

Where the version shows:

- `/health/live` and `/health/ready` answer `{ app: "Croot", version, commit }` (the deploy's health
  check and monitoring can tell which release is serving);
- the client can import it from `virtual:app-version` (read from `package.json` at build time; see
  `vite.config.ts`). It isn't shown in the top bar.

## Before you call it done

```bash
npx tsc -b
npx vitest run
npm run test:ui
```

Commit and push to `main`; releases are started by a person (`bin/snaprows-ops deploy london-1
croot-prod` in snaprows-infra), never on push.
