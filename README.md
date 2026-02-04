# @electron-publish-pro/cli

> Command-line interface for Electron Publish Pro

[![npm version](https://img.shields.io/npm/v/@electron-publish-pro/cli.svg)](https://www.npmjs.com/package/@electron-publish-pro/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Installation

```bash
npm install -g @electron-publish-pro/cli
```

```bash
npx @electron-publish-pro/cli
```

## Authentication

```bash
# Login with your API key
epp login

# Or set environment variable
export EPP_API_KEY=your-api-key
```

## Commands

### Projects

```bash
# List all projects
epp projects list

# Show project details
epp projects show <project-id>

# Sync project from GitHub
epp projects sync <project-id>
```

### Builds

```bash
# Create a new build
epp build --project <project-id> --platforms macos,windows,linux

# Build with specific version
epp build --project <project-id> --version 1.0.0

# Check build status
epp builds status <build-id>

# List builds for a project
epp builds list --project <project-id>

# Download artifacts
epp builds download <build-id> --output ./dist

# View build logs
epp builds logs <build-id>
```

### Analysis

```bash
# Run code analysis
epp analyze --project <project-id> --type code

# Run build analysis
epp analyze --project <project-id> --type build

# Show analysis results
epp analyses show <analysis-id>
```

### Credits

```bash
# Check credit balance
epp credits

# View transaction history
epp credits history
```

## Examples

### Build and wait for completion

```bash
# Start build and wait
epp build --project proj_xxx --platforms macos,windows --wait

# Output:
# ✓ Build queued (build_abc123)
# ⠋ Building... (macOS)
# ⠋ Building... (Windows)
# ✓ Build completed!
#
# Artifacts:
#   • MyApp-1.0.0.dmg (45.2 MB)
#   • MyApp-1.0.0.exe (52.1 MB)
```

### Sync and build

```bash
# Sync latest code, then build
epp projects sync proj_xxx && epp build --project proj_xxx --platforms macos
```

### CI/CD Usage

```bash
# In your CI pipeline
export EPP_API_KEY=${{ secrets.EPP_API_KEY }}

epp build \
  --project proj_xxx \
  --platforms macos,windows,linux \
  --version $(node -p "require('./package.json').version") \
  --wait
```

## Configuration

Create `.epprc` or `epp.config.json` in your project:

```json
{
  "projectId": "proj_xxx",
  "platforms": ["macos", "windows", "linux"]
}
```

Then simply run:

```bash
epp build
```

## Output Formats

```bash
# JSON output for scripting
epp builds list --project proj_xxx --json

# Quiet mode (only errors)
epp build --project proj_xxx --quiet
```

## Links

- 🌐 [Website](https://electronpublish.com)
- 📖 [Documentation](https://electronpublish.com/docs/cli)
- 🐛 [Report Issues](https://github.com/electron-publish-pro/cli/issues)

## License

MIT © [Electron Publish Pro](https://electronpublish.com)
