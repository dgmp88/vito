#!/usr/bin/env bash
#
# Build Vito, assemble a minimal .app bundle, code-sign it, install it to
# /Applications, and launch it. A real bundle + stable signature is required for
# the microphone TCC prompt and for FluidAudio's model download to behave.
#
# Usage:
#   scripts/run.sh                 # debug build, auto-detected identity, launches
#   CONFIG=release scripts/run.sh  # release build
#   VITO_CODESIGN_IDENTITY="Apple Development: You (TEAMID)" scripts/run.sh
#
set -euo pipefail

CONFIG="${CONFIG:-debug}"
APP_NAME="Vito"
BUILD_DIR=".build/${CONFIG}"
# Install to /Applications, not a transient dist/ dir: the Dock pins an app by
# its path, so a bundle that's rebuilt/removed each run can't hold a Dock pin.
INSTALL_BUNDLE="/Applications/${APP_NAME}.app"

echo "==> Building (${CONFIG})…"
swift build -c "${CONFIG}"

# Code-sign so the microphone prompt and entitlements work. TCC keys the
# permission grant to the signature's *designated requirement*. Ad-hoc (-)
# bakes the per-build cdhash into that requirement, so every rebuild looks like
# a new app and macOS re-prompts. A stable signing identity (even a local
# self-signed "Code Signing" cert from Keychain Access) keeps the grant across
# rebuilds. Resolution order: explicit override → a real identity → ad-hoc.
if [[ -n "${VITO_CODESIGN_IDENTITY:-}" ]]; then
  IDENTITY="${VITO_CODESIGN_IDENTITY}"
else
  # Match by the identity's 40-char SHA-1 hash. We intentionally do NOT pass
  # -v ("valid only"): a self-signed local cert reports CSSMERR_TP_NOT_TRUSTED
  # and -v would filter it out, even though codesign signs with it fine (trust
  # only matters for Gatekeeper verification, which never gates a locally built
  # app). Prefer a cert named "Vito", else the first code-signing identity.
  IDENTITY="$(security find-identity -p codesigning 2>/dev/null \
    | grep '"Vito"' | grep -m1 -oE '[0-9A-F]{40}')"
  if [[ -z "${IDENTITY}" ]]; then
    IDENTITY="$(security find-identity -p codesigning 2>/dev/null \
      | grep -m1 -oE '[0-9A-F]{40}')"
  fi
  if [[ -z "${IDENTITY}" ]]; then
    IDENTITY="-"
    echo "!!  No signing identity found — falling back to ad-hoc; macOS will"
    echo "!!  re-prompt for the mic on every rebuild. Create a self-signed"
    echo "!!  'Code Signing' cert in Keychain Access to make the grant stick."
  fi
fi

# Quit any running copy so we can replace the installed bundle cleanly.
osascript -e "quit app \"${APP_NAME}\"" 2>/dev/null || true
sleep 0.5

echo "==> Installing ${INSTALL_BUNDLE}…"
rm -rf "${INSTALL_BUNDLE}"
mkdir -p "${INSTALL_BUNDLE}/Contents/MacOS"
mkdir -p "${INSTALL_BUNDLE}/Contents/Resources"
cp "${BUILD_DIR}/${APP_NAME}" "${INSTALL_BUNDLE}/Contents/MacOS/${APP_NAME}"
cp "Resources/Info.plist" "${INSTALL_BUNDLE}/Contents/Info.plist"
cp "Resources/AppIcon.icns" "${INSTALL_BUNDLE}/Contents/Resources/AppIcon.icns"

# Sign in place, after assembly, so the signature seals the final bundle. The
# entitlements enable the App Sandbox (which isolates the SwiftData store into a
# per-app container so other apps can't collide with it), plus the network and
# microphone access the sandbox would otherwise deny.
echo "==> Code-signing with identity: ${IDENTITY}"
codesign --force --deep \
  --entitlements "Resources/Vito.entitlements" \
  --sign "${IDENTITY}" "${INSTALL_BUNDLE}"

echo "==> Launching…"
open "${INSTALL_BUNDLE}"
