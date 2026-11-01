"""Spotify para Byte: Byte es el control remoto, la música suena en tu PC,
celular o TV con Spotify abierto.

Usa la API oficial de Spotify (Web API). Spotify solo deja controlar la
reproducción a cuentas Premium.

Archivos (en la misma carpeta que este programa):
    spotify.json        -> {"client_id": "..."} de tu app en developer.spotify.com
    spotify_token.json  -> el permiso que das al iniciar sesión (no lo compartas)

Lo que Byte pone se anota en ../data/.musica_reciente.json (las últimas 20).
Así la memoria de la central sabe qué escuchaste y Byte puede proponerte
"¿seguimos con la playlist de ayer?" (herramienta spotify_retomar).

Iniciar sesión una sola vez (abre el navegador):
    python byte_spotify.py --login

byte_internet.py carga estas herramientas solo si ya iniciaste sesión.
"""

import json
import logging
import os
import sys
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(AQUI, "spotify.json")
TOKEN = os.path.join(AQUI, "spotify_token.json")
# Spotify exige 127.0.0.1 (no "localhost") y que sea igual a la de tu app
REDIRECT = "http://127.0.0.1:8806/callback"
PERMISOS = "user-read-playback-state user-modify-playback-state user-read-currently-playing"

# Historial de música: en la carpeta data de la central (la ve la memoria).
# Si no existe (instalación vieja), queda junto a este archivo.
_DATA = os.path.normpath(os.path.join(AQUI, "..", "data"))
HISTORIAL = os.path.join(_DATA if os.path.isdir(_DATA) else AQUI, ".musica_reciente.json")
MAX_HISTORIAL = 20
_MESES = ("ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic")

logger = logging.getLogger("ByteSpotify")

TIPOS = {"cancion": "track", "canción": "track", "artista": "artist", "album": "album",
         "álbum": "album", "playlist": "playlist", "lista": "playlist"}


def _cliente(abrir_navegador=False):
    import spotipy
    from spotipy.cache_handler import CacheFileHandler
    from spotipy.oauth2 import SpotifyPKCE

    with open(CONFIG, encoding="utf-8") as f:
        client_id = json.load(f)["client_id"]
    auth = SpotifyPKCE(
        client_id=client_id,
        redirect_uri=REDIRECT,
        scope=PERMISOS,
        cache_handler=CacheFileHandler(cache_path=TOKEN),
        open_browser=abrir_navegador,
    )
    if abrir_navegador:
        auth.get_access_token()  # abre el navegador y espera tu permiso
    return spotipy.Spotify(auth_manager=auth, requests_timeout=10)


def listo():
    """True si ya hay app configurada y sesión iniciada."""
    return os.path.exists(CONFIG) and os.path.exists(TOKEN)


def _dispositivo(sp):
    """Devuelve el id de un dispositivo donde sonar: el activo o el primero disponible."""
    dispositivos = sp.devices().get("devices", [])
    if not dispositivos:
        return None, []
    activo = next((d for d in dispositivos if d.get("is_active")), None)
    elegido = activo or next((d for d in dispositivos if d.get("type") == "Computer"), dispositivos[0])
    return elegido["id"], dispositivos


def _sin_dispositivo():
    return {"error": "No hay ningún Spotify abierto. Pídele a Alejandro que abra Spotify en el PC, el celular o la TV."}


def _error_spotify(e):
    texto = str(e)
    if "PREMIUM_REQUIRED" in texto or "Premium" in texto:
        return {"error": "Spotify solo deja controlar la música con una cuenta Premium."}
    if "NO_ACTIVE_DEVICE" in texto or "No active device" in texto:
        return _sin_dispositivo()
    logger.exception("Error de Spotify")
    return {"error": f"Spotify respondió con un error: {texto[:200]}"}


def _cuando(t=None):
    """Fecha corta en español, por ejemplo '31-oct 20:15'."""
    t = time.localtime(t)
    return f"{t.tm_mday}-{_MESES[t.tm_mon - 1]} {t.tm_hour:02d}:{t.tm_min:02d}"


def leer_historial():
    try:
        with open(HISTORIAL, encoding="utf-8") as f:
            lista = json.load(f)
        return [m for m in lista if isinstance(m, dict) and m.get("uri")]
    except Exception:
        return []


def anotar(tipo_api, item, busqueda=""):
    """Guarda lo que acaba de sonar. Nunca rompe la música si falla."""
    try:
        lista = [m for m in leer_historial() if m.get("uri") != item.get("uri")]
        lista.append({
            "cuando": _cuando(),
            "tipo": {"track": "canción", "artist": "artista", "album": "álbum"}.get(tipo_api, tipo_api),
            "nombre": item.get("name", ""),
            "de": ", ".join(a["name"] for a in item.get("artists", []) or []) if item.get("artists") else
                  (item.get("owner") or {}).get("display_name", ""),
            "uri": item.get("uri"),
            "busqueda": busqueda,
        })
        lista = lista[-MAX_HISTORIAL:]
        tmp = HISTORIAL + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(lista, f, ensure_ascii=False, indent=1)
        os.replace(tmp, HISTORIAL)
    except Exception:
        logger.exception("No pude anotar la música en el historial")


def _elegir_del_historial(lista, cual=""):
    """El último que coincida con 'cual' (nombre, artista o búsqueda), o el último."""
    cual = (cual or "").strip().lower()
    if cual:
        for m in reversed(lista):
            texto = " ".join(str(m.get(k, "")) for k in ("nombre", "de", "busqueda", "tipo")).lower()
            if cual in texto:
                return m
    return lista[-1] if lista else None


def registrar(mcp):
    """Agrega las herramientas de Spotify al servidor MCP de Byte."""

    @mcp.tool()
    def spotify_poner(busqueda: str, tipo: str = "cancion") -> dict:
        """Pone música en Spotify (suena en el PC, celular o TV de Alejandro, no en Byte).
        busqueda: lo que pidió, por ejemplo "Karol G", "La Bicicleta de Shakira", "rock en español".
        tipo: "cancion", "artista", "album" o "playlist". Si piden un artista o un género,
        usa "artista" o "playlist". Confirma en una frase corta qué pusiste."""
        try:
            sp = _cliente()
            tipo_api = TIPOS.get(tipo.strip().lower(), "track")
            # Sin market="from_token": ese filtro exige otro permiso (user-read-private)
            r = sp.search(q=busqueda, type=tipo_api, limit=1)
            items = r.get(tipo_api + "s", {}).get("items") or []
            items = [i for i in items if i]
            if not items:
                return {"error": f"No encontré '{busqueda}' en Spotify."}
            item = items[0]
            dispositivo, _ = _dispositivo(sp)
            if not dispositivo:
                return _sin_dispositivo()
            if tipo_api == "track":
                sp.start_playback(device_id=dispositivo, uris=[item["uri"]])
            else:
                sp.start_playback(device_id=dispositivo, context_uri=item["uri"])
            autor = ", ".join(a["name"] for a in item.get("artists", [])) if item.get("artists") else ""
            logger.info(f"Spotify: {tipo_api} {item.get('name')}")
            anotar(tipo_api, item, busqueda)
            return {"sonando": item.get("name"), "de": autor, "tipo": tipo_api}
        except Exception as e:
            return _error_spotify(e)

    @mcp.tool()
    def spotify_control(accion: str) -> dict:
        """Controla la música de Spotify. accion: "pausar", "continuar", "siguiente" o "anterior".
        Úsala cuando digan pausa, para la música, sigue, otra canción, la anterior."""
        try:
            sp = _cliente()
            dispositivo, _ = _dispositivo(sp)
            if not dispositivo:
                return _sin_dispositivo()
            a = accion.strip().lower()
            if a.startswith("paus") or a in ("parar", "detener", "stop"):
                sp.pause_playback(device_id=dispositivo)
            elif a.startswith("contin") or a in ("seguir", "reanudar", "play"):
                sp.start_playback(device_id=dispositivo)
            elif a.startswith("sig") or a in ("otra", "saltar", "next"):
                sp.next_track(device_id=dispositivo)
            elif a.startswith("ant") or a in ("atras", "atrás", "previous"):
                sp.previous_track(device_id=dispositivo)
            else:
                return {"error": "Acción no válida. Usa pausar, continuar, siguiente o anterior."}
            return {"hecho": a}
        except Exception as e:
            return _error_spotify(e)

    @mcp.tool()
    def spotify_volumen(nivel: int) -> dict:
        """Cambia el volumen de Spotify (0 a 100) en el equipo donde está sonando.
        Es distinto del volumen del parlante de Byte."""
        try:
            sp = _cliente()
            dispositivo, _ = _dispositivo(sp)
            if not dispositivo:
                return _sin_dispositivo()
            nivel = max(0, min(100, int(nivel)))
            sp.volume(nivel, device_id=dispositivo)
            return {"volumen": nivel}
        except Exception as e:
            return _error_spotify(e)

    @mcp.tool()
    def spotify_retomar(cual: str = "") -> dict:
        """Vuelve a poner música que ya sonó antes ("¿seguimos con la playlist de ayer?", "pon otra vez
        lo de anoche", "la de siempre"). cual: vacío para lo último que sonó, o una pista como
        "rock" o "Karol G" para buscar en lo que ha escuchado. Confirma en una frase qué pusiste."""
        try:
            lista = leer_historial()
            elegido = _elegir_del_historial(lista, cual)
            if not elegido:
                return {"error": "Todavía no tengo música anotada. Pídeme algo y la próxima vez lo retomo."}
            sp = _cliente()
            dispositivo, _ = _dispositivo(sp)
            if not dispositivo:
                return _sin_dispositivo()
            uri = elegido["uri"]
            if uri.startswith("spotify:track:"):
                sp.start_playback(device_id=dispositivo, uris=[uri])
            else:
                sp.start_playback(device_id=dispositivo, context_uri=uri)
            anotar({"canción": "track", "artista": "artist", "álbum": "album"}.get(elegido.get("tipo"), elegido.get("tipo", "")),
                   {"name": elegido.get("nombre"), "uri": uri, "owner": {"display_name": elegido.get("de", "")}},
                   elegido.get("busqueda", ""))
            return {"sonando": elegido.get("nombre"), "de": elegido.get("de"), "tipo": elegido.get("tipo"),
                    "la_ultima_vez": elegido.get("cuando")}
        except Exception as e:
            return _error_spotify(e)

    @mcp.tool()
    def spotify_que_suena() -> dict:
        """Dice qué canción está sonando en Spotify y en qué equipo."""
        try:
            sp = _cliente()
            r = sp.current_playback()
            if not r or not r.get("item"):
                return {"sonando": None, "nota": "No está sonando nada en Spotify."}
            item = r["item"]
            return {
                "sonando": item.get("name"),
                "de": ", ".join(a["name"] for a in item.get("artists", [])),
                "equipo": (r.get("device") or {}).get("name"),
                "pausado": not r.get("is_playing"),
            }
        except Exception as e:
            return _error_spotify(e)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    if "--login" in sys.argv:
        if not os.path.exists(CONFIG):
            sys.exit("Falta spotify.json con tu client_id. Corre activar-spotify.ps1.")
        sp = _cliente(abrir_navegador=True)
        yo = sp.current_user()
        print(f"Sesión iniciada como: {yo.get('display_name') or yo.get('id')} (plan: {yo.get('product', '?')})")
        nombres = [d["name"] for d in sp.devices().get("devices", [])]
        print("Equipos con Spotify abierto:", ", ".join(nombres) if nombres else "ninguno (abre Spotify para probar)")
    else:
        print(__doc__)
