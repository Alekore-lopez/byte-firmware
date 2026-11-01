#!/bin/bash
# crear-acceso-directo.sh — Crea "Byte Desk" en tus Aplicaciones de la Mac.
#
# Después de correrlo una vez, abres Byte como cualquier app: desde Launchpad,
# Spotlight (Cmd + Espacio → "Byte Desk") o el Dock, sin escribir comandos.
#
# Cómo usarlo (en Terminal):
#   bash ~/byte-firmware/herramientas/desk/mac/crear-acceso-directo.sh
#
# Qué hace, paso a paso:
#   1. Revisa que Electron esté completo (con Node.js muy nuevo a veces queda a medias) y lo arregla.
#   2. Crea una app pequeña "Byte Desk.app" en ~/Applications que abre Byte Desk.
#   3. Le pone el ícono de Byte.
# No borra nada tuyo y no pide contraseña.

set -euo pipefail

DESK="$(cd "$(dirname "$0")/.." && pwd)"
ELECTRON_DIR="$DESK/node_modules/electron"
BINARIO="$ELECTRON_DIR/dist/Electron.app/Contents/MacOS/Electron"
APP="$HOME/Applications/Byte Desk.app"

echo "Carpeta de Byte Desk: $DESK"

# 1. Electron completo
if [ ! -d "$ELECTRON_DIR" ]; then
  echo "Falta instalar Byte Desk. Corre primero:  cd \"$DESK\" && npm install"
  exit 1
fi
if [ ! -x "$BINARIO" ] || [ ! -f "$ELECTRON_DIR/path.txt" ]; then
  echo "Electron quedó a medias. Lo arreglo…"
  VERSION="$(node -p "require('$ELECTRON_DIR/package.json').version")"
  ZIP="$(find "$HOME/Library/Caches/electron" -name "electron-v$VERSION-darwin-arm64.zip" 2>/dev/null | head -1 || true)"
  if [ -z "$ZIP" ]; then
    (cd "$DESK" && node node_modules/electron/install.js) || true
    ZIP="$(find "$HOME/Library/Caches/electron" -name "electron-v$VERSION-darwin-arm64.zip" 2>/dev/null | head -1 || true)"
  fi
  if [ -z "$ZIP" ]; then
    echo "No encontré la descarga de Electron. Corre: cd \"$DESK\" && node node_modules/electron/install.js"
    exit 1
  fi
  rm -rf "$ELECTRON_DIR/dist"
  mkdir -p "$ELECTRON_DIR/dist"
  ditto -x -k "$ZIP" "$ELECTRON_DIR/dist"
  printf 'Electron.app/Contents/MacOS/Electron' > "$ELECTRON_DIR/path.txt"
  echo "Electron listo."
fi

# 2. La app pequeña que abre Byte Desk (AppleScript, firmada por la propia Mac)
mkdir -p "$HOME/Applications"
rm -rf "$APP"
osacompile -o "$APP" -e "do shell script quoted form of \"$BINARIO\" & \" \" & quoted form of \"$DESK\" & \" > /dev/null 2>&1 &\""

# 3. Ícono de Byte
TMP="$(mktemp -d)"
ICONSET="$TMP/byte.iconset"
mkdir -p "$ICONSET"
for t in 16 32 128 256 512; do
  sips -z $t $t "$DESK/assets/icono.png" --out "$ICONSET/icon_${t}x${t}.png" >/dev/null
  sips -z $((t * 2)) $((t * 2)) "$DESK/assets/icono.png" --out "$ICONSET/icon_${t}x${t}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/applet.icns"
# macOS nuevo usa el ícono de Assets.car (CFBundleIconName) antes que applet.icns: lo quitamos.
rm -f "$APP/Contents/Resources/Assets.car"
/usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$APP/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Set :CFBundleIconFile applet" "$APP/Contents/Info.plist" 2>/dev/null || true
rm -rf "$TMP"
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
touch "$APP"

echo ""
echo "Listo: \"Byte Desk\" está en tu carpeta Aplicaciones (~/Applications)."
echo "Ábrelo con Cmd + Espacio → escribe \"Byte Desk\" → Enter."
echo "Para tenerlo en el Dock: arrastra \"Byte Desk\" desde la ventana que se abre hasta el Dock."
open -R "$APP"
