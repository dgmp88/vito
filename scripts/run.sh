#!/usr/bin/env bash
#
# Build Vito, assemble a minimal .app bundle, code-sign it (ad-hoc by default),
# and launch it. A real bundle + signature is required for the microphone TCC
# prompt and for FluidAudio's model download to behave.
#
# Usage:
#   scripts/run.sh                 # debug build, ad-hoc signed, launches the app
#   CONFIG=release scripts/run.sh  # release build
#   VITO_CODESIGN_IDENTITY="Apple Development: You (TEAMID)" scripts/run.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

CONFIG="${CONFIG:-debug}"
APP_NAME="Vito"
BUILD_DIR=".build/${CONFIG}"
APP_BUNDLE="dist/${APP_NAME}.app"

echo "==> Building (${CONFIG})…"
swift build -c "${CONFIG}"

echo "==> Assembling ${APP_BUNDLE}…"
rm -rf "${APP_BUNDLE}"
mkdir -p "${APP_BUNDLE}/Contents/MacOS"
mkdir -p "${APP_BUNDLE}/Contents/Resources"

cp "${BUILD_DIR}/${APP_NAME}" "${APP_BUNDLE}/Contents/MacOS/${APP_NAME}"
cp "Resources/Info.plist" "${APP_BUNDLE}/Contents/Info.plist"

# Code-sign so the microphone usage prompt and entitlements work. Ad-hoc (-)
# is enough for local dev; override with VITO_CODESIGN_IDENTITY for a real cert.
IDENTITY="${VITO_CODESIGN_IDENTITY:--}"
echo "==> Code-signing with identity: ${IDENTITY}"
codesign --force --deep --sign "${IDENTITY}" "${APP_BUNDLE}"

echo "==> Launching…"
open "${APP_BUNDLE}"
