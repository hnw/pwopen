# pwopen

pwopen is a Playwright-based CLI tool that opens URLs and provides page screenshots directly in your terminal using Sixel graphics.

It allows for headless browsing, taking screenshots, and verifying page rendering without leaving your command line interface.

## Features

- Playwright Automation: Robust browser control using Chromium.
- Screenshots with Sixel: View page screenshots directly in Sixel-supported terminals (e.g., iTerm2, WezTerm, foot).
- Secure: Designed to run with a custom seccomp profile for enhanced security in Docker.
- Configurable: Supports headed mode, sandbox options, and various runtime flags.

## Usage

### Via Docker (Recommended)

You can run `pwopen` directly from the GitHub Container Registry.

> Note: To use Sixel screenshots, you must run the container with an interactive TTY (`-it`).
> For security, it is recommended to use the provided `seccomp_profile.json`.

Command:

```bash
# Basic usage (Print HTML/Title or check connectivity)
docker run --rm -it --init --ipc=host \
  --security-opt seccomp=./seccomp_profile.json \
  ghcr.io/hnw/pwopen:latest https://example.com

# With Sixel Screenshot enabled
docker run --rm -it --init --ipc=host \
  --security-opt seccomp=./seccomp_profile.json \
  ghcr.io/hnw/pwopen:latest --screenshot https://example.com

```

_If you cannot use the seccomp profile, you may need to use `--cap-add=SYS_ADMIN` (less secure) or `--security-opt seccomp=unconfined` to allow Chrome to run._

### Local Installation

Requirements: Node.js 18+

```bash
# Install dependencies
npm ci

# Build the project
npm run build

# Run via CLI
node ./dist/main.js --screenshot https://google.com

```

## Options

| Option         | Description                                |
| -------------- | ------------------------------------------ |
| `--headed`     | Show browser window (default: headless)    |
| `--screenshot` | Render a Sixel screenshot after page load  |
| `--full-page`  | Capture full page when taking a screenshot |
| `--sandbox`    | Enable Chromium sandbox (default: true)    |
| `--no-sandbox` | Disable Chromium sandbox                   |
| `-h, --help`   | display help for command                   |

## License

MIT
