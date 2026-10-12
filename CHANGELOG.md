# electron-publish-pro

## 0.3.0

### Minor Changes

- fc1d51b: Checks now go to the dashboard project with the same GitHub repo or name, so the CLI and the website share one project and history. The default project name is the git remote's repo name. New `epp projects` lists your dashboard projects. The CLI no longer writes `.epp/` or edits `.gitignore`.

## 0.2.2

### Patch Changes

- dd17f58: When sign-in fails, `epp login` explains that GitHub sign-in accounts need to set a password in Account Settings first.
- cc57d39: `epp login` accepts a pasted password. Before, the Enter key that comes with a paste was added to the password, so sign-in failed.

## 0.2.1

### Patch Changes

- 597473d: `epp --version` and `epp help` now show the installed version instead of 0.1.0.

## 0.2.0

### Minor Changes

- c361631: Add `epp login`, `epp logout` and `epp whoami`. `epp login` signs in with your email and password and stores an API token, so `epp check` works without setting `EPP_TOKEN`.
