#!/usr/bin/env bash
# install.sh — macOS/Linux one-liner installer for see-crets
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/yldgio/see-crets/main/install.sh | bash
#
#   # Pin a specific version:
#   VERSION=1.2.3 curl -fsSL https://raw.githubusercontent.com/yldgio/see-crets/main/install.sh | bash
#
#   # Install to a custom prefix:
#   PREFIX=/usr/local/bin curl -fsSL https://raw.githubusercontent.com/yldgio/see-crets/main/install.sh | bash
#
# Supported platforms:
#   macOS  arm64 / x64
#   Linux  x64 / arm64 (glibc and musl)
#
# Requirements: bash >= 3.2, curl or wget, sha256sum (Linux) or shasum (macOS)

set -euo pipefail

# Require bash — guard against accidental invocation via /bin/sh (dash, etc.)
if [ -z "${BASH_VERSION:-}" ]; then
  printf '[see-crets] ERROR: This script requires bash. Run:\n' >&2
  printf '  curl -fsSL https://raw.githubusercontent.com/yldgio/see-crets/main/install.sh | bash\n' >&2
  exit 1
fi

# ── Constants ────────────────────────────────────────────────────────────────
REPO="yldgio/see-crets"
BINARY="see-crets"
DEFAULT_PREFIX="${HOME:-/root}/.local/bin"

# ── Configurable via environment ─────────────────────────────────────────────
# VERSION: pin a release, e.g. VERSION=1.2.3 — strip leading "v" if present
VERSION="${VERSION:-}"
VERSION="${VERSION#v}"

# PREFIX: installation directory (default: $HOME/.local/bin)
PREFIX="${PREFIX:-${DEFAULT_PREFIX}}"

# ── Globals ──────────────────────────────────────────────────────────────────
PLATFORM_OS=""    # macos | linux
PLATFORM_ARCH=""  # x64 | arm64
ASSET_NAME=""     # see-crets-{os}-{arch}[-musl]
TMP_DIR=""        # created in main(), cleaned up via EXIT trap

# ── Logging ───────────────────────────────────────────────────────────────────
info()  { printf '\033[1;34m[see-crets]\033[0m %s\n' "$*" >&2; }
warn()  { printf '\033[1;33m[see-crets] WARNING:\033[0m %s\n' "$*" >&2; }
error() { printf '\033[1;31m[see-crets] ERROR:\033[0m %s\n' "$*" >&2; }
die()   { error "$*"; exit 1; }

# ── VERSION validation ────────────────────────────────────────────────────────
# Reject path traversal attempts (e.g. "1.2.3/../../other-org/other-repo/v9.9.9")
if [ -n "${VERSION}" ]; then
  case "${VERSION}" in
    */* | *\\* | *..*) die "Invalid VERSION: path traversal characters not allowed." ;;
  esac
fi

# ── Platform detection ────────────────────────────────────────────────────────
detect_platform() {
  local os arch musl
  musl=""   # empty = glibc/unknown; non-empty = musl

  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"

  case "${os}" in
    darwin) PLATFORM_OS="macos" ;;
    linux)  PLATFORM_OS="linux" ;;
    *)      die "Unsupported OS: ${os}. Only macOS and Linux are supported." ;;
  esac

  case "${arch}" in
    x86_64)          PLATFORM_ARCH="x64" ;;
    aarch64 | arm64) PLATFORM_ARCH="arm64" ;;
    *)               die "Unsupported architecture: ${arch}. Only x64 and arm64 are supported." ;;
  esac

  # Musl libc detection (Linux only)
  if [ "${PLATFORM_OS}" = "linux" ]; then
    if [ -f /etc/alpine-release ]; then
      musl="true"
    elif command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -q musl; then
      musl="true"
    fi
  fi

  ASSET_NAME="${BINARY}-${PLATFORM_OS}-${PLATFORM_ARCH}"
  if [ -n "${musl}" ]; then
    ASSET_NAME="${ASSET_NAME}-musl"
  fi

  info "Platform: ${PLATFORM_OS}/${PLATFORM_ARCH}${musl:+ (musl)} → ${ASSET_NAME}"
}

# ── Version resolution ────────────────────────────────────────────────────────
resolve_version() {
  if [ -n "${VERSION}" ]; then
    info "Using pinned version: v${VERSION}"
    return 0
  fi

  info "Resolving latest release from GitHub..."

  local api_url="https://api.github.com/repos/${REPO}/releases/latest"
  local tmp_file="${TMP_DIR}/api-response.json"

  if command -v curl >/dev/null 2>&1; then
    local http_code
    http_code="$(curl -sSL -o "${tmp_file}" -w '%{http_code}' "${api_url}")"

    case "${http_code}" in
      200) ;;
      403 | 429)
        error "GitHub API rate limit exceeded (HTTP ${http_code})."
        error "Fix: set VERSION=x.y.z before the curl command, e.g.:"
        error "  VERSION=0.1.0 curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | bash"
        error "Browse releases: https://github.com/${REPO}/releases"
        exit 1
        ;;
      *)
        die "GitHub API error (HTTP ${http_code}). Set VERSION=x.y.z to bypass API lookup."
        ;;
    esac

  elif command -v wget >/dev/null 2>&1; then
    if ! wget -qO "${tmp_file}" "${api_url}" 2>/dev/null; then
      die "Failed to reach GitHub API. Set VERSION=x.y.z to bypass API lookup."
    fi
    # wget doesn't expose HTTP status codes easily; detect rate-limit by body content
    if grep -qi '"message".*"API rate limit' "${tmp_file}"; then
      error "GitHub API rate limit exceeded."
      error "Fix: set VERSION=x.y.z before the curl/wget command, e.g.:"
      error "  VERSION=0.1.0 curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | bash"
      error "Browse releases: https://github.com/${REPO}/releases"
      exit 1
    fi

  else
    die "Neither curl nor wget found. Please install one and retry."
  fi

  VERSION="$(grep -o '"tag_name": *"[^"]*"' "${tmp_file}" \
    | head -1 \
    | sed 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/')"

  if [ -z "${VERSION}" ]; then
    die "Could not parse version from GitHub API response. Set VERSION=x.y.z to bypass."
  fi

  info "Latest version: v${VERSION}"
}

# ── Download helper ────────────────────────────────────────────────────────────
# fetch <url> <output-path>
fetch() {
  local url="${1}"
  local dest="${2}"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --progress-bar "${url}" -o "${dest}"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "${dest}" "${url}"
  else
    die "Neither curl nor wget found. Please install one and retry."
  fi
}

# ── SHA-256 verification ──────────────────────────────────────────────────────
verify_sha256() {
  local binary="${1}"
  local checksums_file="${2}"
  local asset="${3}"

  # Extract expected hash — checksums.txt format: "<hash>  <filename>"
  local expected
  expected="$(grep "[[:space:]]${asset}$" "${checksums_file}" | awk '{print $1}')"

  if [ -z "${expected}" ]; then
    die "No checksum entry for '${asset}' in checksums.txt — cannot verify integrity. Aborting."
  fi

  local actual
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "${binary}" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "${binary}" | awk '{print $1}')"
  else
    warn "No SHA-256 tool found (sha256sum / shasum). Skipping verification."
    return 0
  fi

  if [ "${expected}" != "${actual}" ]; then
    error "SHA-256 mismatch for ${asset}!"
    error "  Expected: ${expected}"
    error "  Got:      ${actual}"
    die "Checksum verification failed — download may be corrupted or tampered with."
  fi

  info "Checksum verified ✓"
}

# ── PATH guidance ─────────────────────────────────────────────────────────────
path_guidance() {
  local install_dir="${1}"

  # Check whether install_dir is already on PATH
  case ":${PATH}:" in
    *":${install_dir}:"*) return 0 ;;
  esac

  warn "${install_dir} is not on your \$PATH."

  local shell_name
  shell_name="$(basename "${SHELL:-sh}")"

  case "${shell_name}" in
    fish)
      warn "Run once to add it:"
      warn "  fish_add_path ${install_dir}"
      ;;
    zsh)
      warn "Add to ~/.zshrc:"
      warn "  export PATH=\"${install_dir}:\$PATH\""
      ;;
    bash)
      warn "Add to ~/.bashrc or ~/.bash_profile:"
      warn "  export PATH=\"${install_dir}:\$PATH\""
      ;;
    *)
      warn "Add to your shell's startup file:"
      warn "  export PATH=\"${install_dir}:\$PATH\""
      ;;
  esac
}

# ── Bun fallback (last resort) ────────────────────────────────────────────────
bun_fallback() {
  local dest="${1}"

  if ! command -v bun >/dev/null 2>&1; then
    die "No prebuilt binary for ${ASSET_NAME} and bun is not installed. Install bun (https://bun.sh) or use a supported platform."
  fi

  warn "No prebuilt binary for ${ASSET_NAME}. Falling back to bun build from source."
  warn "This requires the see-crets repo to be cloned locally."

  if [ ! -f "./src/cli.ts" ]; then
    error "src/cli.ts not found in the current directory."
    error "Clone the repo first:"
    die "  git clone https://github.com/${REPO}.git && cd ${BINARY}"
  fi

  info "Building from source with bun..."
  bun build ./src/cli.ts --compile --outfile "${dest}"
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
  # Parse --prefix / --prefix=VALUE flag (useful when running the script directly)
  while [ "${#}" -gt 0 ]; do
    case "${1}" in
      --prefix=*) PREFIX="${1#*=}"; shift ;;
      --prefix)
        if [ "${#}" -lt 2 ] || [ -z "${2:-}" ]; then
          die "--prefix requires a value"
        fi
        PREFIX="${2}"; shift 2
        ;;
      --) shift; break ;;
      -*) die "Unknown option: ${1}" ;;
      *)  break ;;
    esac
  done

  # ── Set up temp directory and cleanup trap ───────────────────────────────────
  TMP_DIR="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '${TMP_DIR}'" EXIT

  info "Installing ${BINARY}..."

  # ── Detect platform ───────────────────────────────────────────────────────────
  detect_platform

  # ── Resolve version ───────────────────────────────────────────────────────────
  resolve_version

  local base_url="https://github.com/${REPO}/releases/download/v${VERSION}"
  local asset_url="${base_url}/${ASSET_NAME}"
  local checksums_url="${base_url}/checksums.txt"

  local dest="${PREFIX}/${BINARY}"

  # ── Download ───────────────────────────────────────────────────────────────────
  local download_ok=false

  info "Downloading ${ASSET_NAME}..."
  if fetch "${asset_url}" "${TMP_DIR}/${ASSET_NAME}" 2>/dev/null; then
    download_ok=true

    # Download and verify checksums
    info "Downloading checksums.txt..."
    if fetch "${checksums_url}" "${TMP_DIR}/checksums.txt" 2>/dev/null; then
      verify_sha256 "${TMP_DIR}/${ASSET_NAME}" "${TMP_DIR}/checksums.txt" "${ASSET_NAME}"
    else
      die "Could not download checksums.txt — cannot verify integrity. Aborting."
    fi
  else
    warn "No prebuilt binary found for ${ASSET_NAME} at v${VERSION}."
  fi

  # ── Create install directory ──────────────────────────────────────────────────
  mkdir -p "${PREFIX}"

  # ── Install binary ────────────────────────────────────────────────────────────
  if [ "${download_ok}" = "true" ]; then
    cp "${TMP_DIR}/${ASSET_NAME}" "${dest}"
  else
    bun_fallback "${dest}"
  fi

  # Make executable
  chmod +x "${dest}"

  # Strip macOS quarantine attribute (silently ignore if xattr not present)
  if [ "${PLATFORM_OS}" = "macos" ]; then
    xattr -d com.apple.quarantine "${dest}" 2>/dev/null || true
  fi

  # ── PATH guidance ──────────────────────────────────────────────────────────────
  path_guidance "${PREFIX}"

  # ── Post-install message ───────────────────────────────────────────────────────
  info ""
  info "\033[1;32m✓ see-crets v${VERSION} installed → ${dest}\033[0m"
  info ""
  info "Next steps:"
  info "  1. Verify:          see-crets --version"
  info "  2. Set backend:     export SEE_CRETS_BACKEND=keychain  # or: libsecret, pass"
  info "  3. Try it:          see-crets set mykey myvalue"
  info ""
  info "Docs: https://github.com/${REPO}#readme"
}

main "$@"
