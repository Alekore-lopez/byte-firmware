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
#   2. Le dice a macOS para qué se usa el micrófono y la red local.
#   3. Crea "Byte Desk.app" y "Cara de Byte.app" en ~/Applications, con el ícono de Byte.
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

# 2. Que macOS sepa para qué pide Electron el micrófono y la red local.
#    Si falta ese texto, macOS cierra la app al pedir el micrófono.
PLIST_EL="$ELECTRON_DIR/dist/Electron.app/Contents/Info.plist"
CAMBIO=0
if ! /usr/libexec/PlistBuddy -c "Print :NSMicrophoneUsageDescription" "$PLIST_EL" >/dev/null 2>&1; then
  /usr/libexec/PlistBuddy -c "Add :NSMicrophoneUsageDescription string Byte te escucha cuando tocas su cara." "$PLIST_EL"; CAMBIO=1
fi
if ! /usr/libexec/PlistBuddy -c "Print :NSLocalNetworkUsageDescription" "$PLIST_EL" >/dev/null 2>&1; then
  /usr/libexec/PlistBuddy -c "Add :NSLocalNetworkUsageDescription string Byte se conecta a su central en el HP de la casa." "$PLIST_EL"; CAMBIO=1
fi
if [ "$CAMBIO" = 1 ]; then
  codesign --force --deep --sign - "$ELECTRON_DIR/dist/Electron.app" >/dev/null 2>&1 || true
fi

# 3. Dos apps pequeñas: "Byte Desk" (la app) y "Cara de Byte" (solo la cara).
#    Abren Electron con "open", así macOS le pregunta los permisos a Electron.
mkdir -p "$HOME/Applications"
TMP="$(mktemp -d)"
ICONSET="$TMP/byte.iconset"
mkdir -p "$ICONSET"
for t in 16 32 128 256 512; do
  sips -z $t $t "$DESK/assets/icono.png" --out "$ICONSET/icon_${t}x${t}.png" >/dev/null
  sips -z $((t * 2)) $((t * 2)) "$DESK/assets/icono.png" --out "$ICONSET/icon_${t}x${t}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$TMP/byte.icns"

crear_app() {
  local destino="$1" extra="$2"
  rm -rf "$destino"
  osacompile -o "$destino" -e "do shell script \"open -n -a \" & quoted form of \"$ELECTRON_DIR/dist/Electron.app\" & \" --args \" & quoted form of \"$DESK\" & \" $extra\""
  cp "$TMP/byte.icns" "$destino/Contents/Resources/applet.icns"
  # macOS nuevo usa el ícono de Assets.car (CFBundleIconName) antes que applet.icns: lo quitamos.
  rm -f "$destino/Contents/Resources/Assets.car"
  /usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$destino/Contents/Info.plist" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile applet" "$destino/Contents/Info.plist" 2>/dev/null || true
  codesign --force --deep --sign - "$destino" >/dev/null 2>&1 || true
  touch "$destino"
}
crear_app "$APP" ""
crear_app "$HOME/Applications/Cara de Byte.app" "--cara"
rm -rf "$TMP"

echo ""
echo "Listo: \"Byte Desk\" y \"Cara de Byte\" están en tu carpeta Aplicaciones (~/Applications)."
echo "Ábrelo con Cmd + Espacio → escribe \"Byte Desk\" → Enter."
echo "\"Cara de Byte\" abre solo la cara: tócala para hablarle. Puedes arrastrarla al Dock."
open -R "$APP"
