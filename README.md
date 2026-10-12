# electron-publish-pro

Run the [Electron Publish Pro](https://electronpublish.com) Release Readiness Check from your terminal, CI or an AI agent. It finds what blocks a signed release of your Electron app: code signing, notarization, security settings, store requirements and auto-update.

## Quick start

```bash
npm install -g electron-publish-pro

epp login                                      # your electronpublish.com email and password
cd my-electron-app
epp init --goal direct --platforms macos,windows
epp check
```

Node.js 18 or later. No GitHub connection needed: the CLI reads files from the current folder.
Without installing: `npx electron-publish-pro check`.

## Commands

| Command | What it does |
|---|---|
| `epp login` | Asks for your email and password, creates an API token and stores it in `~/.config/epp/credentials.json` |
| `epp logout` | Revokes the stored token and deletes it |
| `epp whoami` | Shows which token `epp` uses |
| `epp init` | Creates `epp.json`. Asks for distribution and platforms, or takes `--goal`, `--platforms`, `--name`, `--yes` |
| `epp check` | Sends the project files to the Readiness Check and prints the report |
| `epp files` | Lists the files `epp check` would send, without sending anything |

`epp check` options:

- `--json` prints the report as JSON (for scripts and AI agents)
- `--fail-on fail` exits with code 1 if any category fails; `--fail-on warning` also on warnings
- `--goal` and `--platforms` override `epp.json`

Exit codes: `0` done, `1` `--fail-on` threshold reached, `2` error (no token, bad config, API error, daily limit).

## epp.json

```json
{
  "$schema": "https://electronpublish.com/schema/epp.v1.json",
  "version": 1,
  "project": "my-app",
  "goal": "direct",
  "platforms": ["macOS", "Windows"],
  "check": {
    "include": ["packages/main/src/**"],
    "ignore": ["vendor/**"]
  }
}
```

- `goal`: `direct` (signed downloads with auto-update) or `store` (Mac App Store, Microsoft Store, Snap Store)
- `platforms`: any of `macOS`, `Windows`, `Linux`
- `check.include`: extra files to send when your main process lives somewhere unusual
- `check.ignore`: files to leave out of the file tree and contents

Commit `epp.json`. The first `epp check` creates `.epp/project.json` with the project id so later checks land in the same project; it is added to `.gitignore`.

## What is sent

The file list (up to 2,000 paths) and the contents of known config and entry files: `package.json`, electron-builder / Forge / electron-vite config, entitlements, main-process and preload files, HTML entry files. At most 150 KB. Run `epp files` to see the exact list. Source code is not stored; only the report is saved. File contents are sent to Anthropic's Claude API to write the report.

## Tokens

`epp check` uses `EPP_TOKEN` if it is set, otherwise the token saved by `epp login`. Signed up with GitHub and have no password? Create a token in Account Settings → API Tokens on electronpublish.com and set `EPP_TOKEN`.

## In CI

```yaml
- run: npx electron-publish-pro check --fail-on fail
  env:
    EPP_TOKEN: ${{ secrets.EPP_TOKEN }}
```

## Releasing

Releases go through [Changesets](https://github.com/changesets/changesets):

1. Describe your change: `npx changeset` (pick patch, minor or major) and commit the file it creates.
2. Merge to `main`. The Publish workflow opens a "Version Packages" pull request that bumps the version and updates `CHANGELOG.md`.
3. Merge that pull request. The workflow publishes to npm with provenance.

The workflow needs an `NPM_TOKEN` repository secret: an npm granular access token with read and write access to the `electron-publish-pro` package (for the first publish: all packages, then narrow it to this one).

## License

MIT
