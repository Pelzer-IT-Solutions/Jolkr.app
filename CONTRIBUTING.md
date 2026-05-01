# Contributing to Jolkr

This document describes how the Jolkr repository is organized and how
changes flow into a release. The setup is enforced by GitHub branch
protection + repo settings — following this guide isn't optional, the
repo will reject anything that doesn't.

## Branch model

| Branch | Purpose | Rules |
|---|---|---|
| `main` | Released code only. Reflects the last published version. | **Protected.** No direct pushes, no force-pushes, no deletions. Linear history. Admins included. |
| `dev`  | Integration branch. Free-form. | No protection — push, force-push, merge feature branches, anything goes. |
| `<your-branch>` | Optional short-lived feature branch. | Merge into `dev` first; never PR directly to `main`. |

`dev` is allowed to be messy. `main` stays clean.

## How a change reaches main

```
[work on dev — direct pushes / feature branches merged in / force-push]
                              │
                              ▼
              gh pr create --base main --head dev
                              │
                              ▼
        ✓ check-source workflow verifies head = dev
        ✓ Squash merge (the only merge button you'll see)
                              │
                              ▼
                    main = clean linear history
```

### Step by step

1. **Make changes on `dev`.** Push directly, force-push, merge feature
   branches into `dev` — whatever is most pragmatic.
2. **Open a PR from `dev` → `main`.**
   ```bash
   gh pr create --base main --head dev --title "..." --body "..."
   ```
3. **Wait for the `check-source` workflow** to pass (it confirms the PR
   originates from `dev`; PRs from any other branch are rejected).
4. **Squash-merge the PR.** Squash is the only merge strategy enabled
   in repo settings — rebase and merge-commits are off.
   ```bash
   gh pr merge <PR#> --squash
   ```
5. **Sync `dev` to `main`** so the next PR doesn't carry the squashed
   commits as duplicates:
   ```bash
   git fetch origin main:main
   git checkout dev
   git reset --hard origin/main
   git push --force-with-lease origin dev
   ```

## Versioning

Version numbers are tracked in five files. **Never edit them by hand** —
use the bump script:

```bash
cd jolkr-app
npm run version:bump 0.10.4    # or any X.Y.Z
```

The script updates all of:

- `jolkr-app/package.json`
- `jolkr-app/src-tauri/tauri.conf.json`
- `jolkr-app/src-tauri/Cargo.toml` (`[package]` version)
- `jolkr-app/src-tauri/Cargo.lock` (the `jolkr-app` package entry)
- `jolkr-server/Cargo.toml` (`[workspace.package]` version)

It's idempotent (re-running with the same version is a no-op) and fails
fast if any file's expected pattern can't be found.

## Releasing

1. **Bump the version on `dev`** (see above), commit, push.
2. **PR `dev` → `main`** and squash-merge.
3. **Tag `main`** with the version prefixed by `v`:
   ```bash
   git fetch origin main:main
   git checkout main
   git tag -a v0.10.4 -m "Release v0.10.4"
   git push origin v0.10.4
   ```
4. **CI takes over.** The push of a `v*` tag triggers
   `.github/workflows/release.yml`, which:
   - Builds Tauri desktop installers for Windows, macOS (Apple
     Silicon), and Linux (deb / AppImage / rpm).
   - Builds Android APK + AAB, signs both with the release keystore.
   - Uploads the signed APK + AAB as a workflow artifact.
   - Attaches the APK to a **draft** GitHub Release (publish manually
     once you've confirmed everything looks right).
   - Uploads the AAB to the Play Store **Internal testing** track as a
     **draft** release. Promote it manually in the Play Console.

There is **no** post-release auto-bump — the project no longer mutates
`main` from CI. Bump the next development version manually on `dev`
when you're ready.

## Play Store note

The Jolkr app is currently in **draft** state on Play Console (not yet
officially published). Google only allows draft releases on draft apps,
so the upload step uses `status: draft`. Once the app goes public,
switch `status` back to `completed` in
`.github/workflows/release.yml` so internal-track releases roll out
automatically.

## Checks that run on every PR to main

| Check | Source | What it does |
|---|---|---|
| `check-source` | `.github/workflows/pr-source-branch-check.yml` | Fails if PR head branch isn't `dev`. |

The release workflow only runs on tag pushes, not on PRs.

## What's enforced by GitHub (you can't bypass it)

- **Squash-only merges.** Repo settings: `allow_squash_merge` on,
  `allow_merge_commit` and `allow_rebase_merge` off.
- **PRs required for `main`.** Branch protection.
- **Linear history on `main`.** Branch protection.
- **No force-push / deletion of `main`.** Branch protection.
- **Admins are not exempt.** Branch protection has
  `enforce_admins: true`.
- **PRs to `main` must originate from `dev`.** Workflow check.

If you need to override any of these in an emergency, you'll have to
temporarily relax the branch protection via the GitHub UI or
`gh api -X DELETE repos/Pelzer-IT-Solutions/Jolkr.app/branches/main/protection`,
do the work, and put the protection back.

## Local development quickstart

```bash
# Frontend (web + Tauri shell)
cd jolkr-app
npm install
npm run dev              # web only (Vite at localhost:5173)
npx tauri dev            # native shell (Windows/macOS/Linux)

# Backend (Rust workspace)
cd jolkr-server
cargo build --release    # full stack
cargo run -p jolkr-api   # API only
```

For the Docker Compose stack (postgres, redis, minio, nats, nginx,
api), see `jolkr-server/docker/`.
