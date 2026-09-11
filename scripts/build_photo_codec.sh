#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEFAULT_VERSION="3.2.0"
DEFAULT_SHA256="6f30092cef9fb839779646608f4ee14ae3cbac989c47fa05e841b0841f09878e"
VERSION="${LIBJPEG_TURBO_VERSION:-$DEFAULT_VERSION}"
EXPECTED_SHA256="${LIBJPEG_TURBO_SHA256:-$DEFAULT_SHA256}"

for command in emcc emcmake cmake ninja curl tar sha256sum find cp mkdir mktemp; do
  command -v "$command" >/dev/null || { echo "Missing build tool: $command" >&2; exit 1; }
done

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "LIBJPEG_TURBO_VERSION must be a release version such as 3.2.0" >&2
  exit 1
fi
if [[ ! "$EXPECTED_SHA256" =~ ^[a-f0-9]{64}$ ]]; then
  echo "LIBJPEG_TURBO_SHA256 must be a lowercase SHA-256 digest" >&2
  exit 1
fi
if [[ "$VERSION" != "$DEFAULT_VERSION" && -z "${LIBJPEG_TURBO_SHA256:-}" ]]; then
  echo "An overridden LIBJPEG_TURBO_VERSION requires LIBJPEG_TURBO_SHA256." >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
ARCHIVE="$WORK/libjpeg-turbo-${VERSION}.tar.gz"
SOURCE="$WORK/libjpeg-turbo-${VERSION}"
OUTPUT="$WORK/moon-jpeg-codec.js"
VENDOR="$ROOT/public/vendor"

# This is the project's published source tarball, not GitHub's generated
# "Source code" archive. It is not extracted or compiled until verified.
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "https://github.com/libjpeg-turbo/libjpeg-turbo/releases/download/${VERSION}/libjpeg-turbo-${VERSION}.tar.gz" \
  --output "$ARCHIVE"
printf '%s  %s\n' "$EXPECTED_SHA256" "$ARCHIVE" | sha256sum --check --status || {
  echo "libjpeg-turbo source archive checksum mismatch" >&2
  exit 1
}

tar -xzf "$ARCHIVE" -C "$WORK"
[[ -d "$SOURCE" ]] || { echo "Expected source directory was not present in the verified archive" >&2; exit 1; }

emcmake cmake -G Ninja -S "$SOURCE" -B "$WORK/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DENABLE_SHARED=OFF -DENABLE_STATIC=ON \
  -DWITH_SIMD=OFF -DWITH_TURBOJPEG=OFF -DWITH_TOOLS=OFF -DWITH_TESTS=OFF
cmake --build "$WORK/build" --target jpeg-static --parallel 2
LIBRARY="$(find "$WORK/build" -name libjpeg.a -print -quit)"
[[ -n "$LIBRARY" && -f "$LIBRARY" ]] || { echo "libjpeg-turbo static library was not built" >&2; exit 1; }

emcc "$ROOT/codec/jpeg_scaled.c" "$LIBRARY" -I"$SOURCE/src" -I"$WORK/build" -O3 \
  -s MODULARIZE=1 -s EXPORT_NAME=createMoonJpegCodec -s SINGLE_FILE=1 \
  -s ENVIRONMENT=web,worker,node -s FILESYSTEM=0 -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=16777216 -s MAXIMUM_MEMORY=201326592 -s STACK_SIZE=1048576 \
  -s ABORTING_MALLOC=0 \
  -s 'EXPORTED_FUNCTIONS=["_malloc","_free","_moon_decode","_moon_data","_moon_width","_moon_height","_moon_length","_moon_source_width","_moon_source_height","_moon_progressive","_moon_orientation","_moon_release"]' \
  -s 'EXPORTED_RUNTIME_METHODS=["HEAPU8"]' \
  -o "$OUTPUT"

[[ -s "$OUTPUT" ]] || { echo "Emscripten did not produce a single-file codec module" >&2; exit 1; }
[[ -f "$SOURCE/LICENSE.md" && -f "$SOURCE/README.ijg" ]] || {
  echo "Verified libjpeg-turbo source is missing required license notices" >&2
  exit 1
}

mkdir -p "$VENDOR"
cp "$OUTPUT" "$VENDOR/moon-jpeg-codec.js"
cp "$SOURCE/LICENSE.md" "$VENDOR/libjpeg-turbo-LICENSE.md"
cp "$SOURCE/README.ijg" "$VENDOR/libjpeg-turbo-README.ijg"
printf '%s  libjpeg-turbo-%s.tar.gz\n' "$EXPECTED_SHA256" "$VERSION" > "$VENDOR/codec-source.sha256"
printf '%s\n' "$VERSION" > "$VENDOR/codec-source-version.txt"

echo "Built verified libjpeg-turbo ${VERSION} reduced-IDCT JPEG codec."
