# electron-publish-pro

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
