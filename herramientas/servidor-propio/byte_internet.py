"""Herramientas de internet para Byte: buscar, noticias y clima.

Es un servidor MCP: le ofrece "herramientas" a la IA de Byte. Cuando le
preguntas algo actual ("¿qué pasó hoy con...?", "¿va a llover en Bogotá?"),
la IA decide usar una de estas herramientas, este programa la ejecuta en tu
PC y le devuelve el resultado para que te responda.

No necesita claves: la búsqueda usa DuckDuckGo y el clima, Open-Meteo.

Dos formas de usarlo:
    python byte_internet.py           -> modo central (red local, puerto 8805).
                                         La central lo llama desde Docker en
                                         http://host.docker.internal:8805/mcp
    python byte_internet.py --stdio   -> modo xiaozhi.me (con mcp_pipe.py)
"""

import json
import logging
import socket
import sys
import time
import urllib.parse
import urllib.request

from fastmcp import FastMCP

import os

if sys.stdout is None or sys.stderr is None:
    # Arrancado sin ventana (pythonw): todo va a registro.txt junto a este archivo
    _log = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "registro.txt"), "a", encoding="utf-8", buffering=1)
    sys.stdout = sys.stderr = _log
elif sys.platform == "win32":
    sys.stderr.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")

logger = logging.getLogger("ByteInternet")
mcp = FastMCP("ByteInternet")

REGION = "co-es"  # resultados de Colombia, en español
MAX_RESULTADOS = 5


def _recortar(texto: str, largo: int = 300) -> str:
    texto = " ".join((texto or "").split())
    return texto if len(texto) <= largo else texto[: largo - 1] + "…"


@mcp.tool()
def buscar_en_internet(consulta: str) -> dict:
    """Busca en internet información actual o datos que no sabes (precios, resultados
    deportivos, personas, lugares, horarios, definiciones). Devuelve títulos y resúmenes
    de los primeros resultados. Responde con tus palabras, en una o dos frases."""
    from ddgs import DDGS

    logger.info(f"Buscando: {consulta}")
    resultados = DDGS().text(consulta, region=REGION, max_results=MAX_RESULTADOS)
    return {
        "consulta": consulta,
        "resultados": [
            {"titulo": r.get("title", ""), "resumen": _recortar(r.get("body", "")), "fuente": r.get("href", "")}
            for r in resultados
        ],
    }


@mcp.tool()
def noticias(tema: str) -> dict:
    """Busca las noticias más recientes sobre un tema (por ejemplo "Colombia",
    "tecnología", "Millonarios"). Usa esta herramienta cuando pregunten qué está
    pasando o qué hay de nuevo. Resume las dos o tres más importantes."""
    from ddgs import DDGS

    logger.info(f"Noticias: {tema}")
    resultados = DDGS().news(tema, region=REGION, max_results=MAX_RESULTADOS)
    return {
        "tema": tema,
        "noticias": [
            {
                "titulo": r.get("title", ""),
                "resumen": _recortar(r.get("body", ""), 220),
                "medio": r.get("source", ""),
                "fecha": r.get("date", ""),
            }
            for r in resultados
        ],
    }


# Códigos de clima de Open-Meteo (WMO) en palabras
CIELO = {
    0: "despejado", 1: "casi despejado", 2: "parcialmente nublado", 3: "nublado",
    45: "con niebla", 48: "con niebla", 51: "con llovizna débil", 53: "con llovizna",
    55: "con llovizna fuerte", 61: "con lluvia débil", 63: "con lluvia", 65: "con lluvia fuerte",
    66: "con lluvia helada", 67: "con lluvia helada", 71: "con nieve débil", 73: "con nieve",
    75: "con nieve fuerte", 80: "con chubascos", 81: "con chubascos fuertes",
    82: "con aguaceros muy fuertes", 95: "con tormenta", 96: "con tormenta y granizo",
    99: "con tormenta y granizo",
}


# --- Red más confiable ---------------------------------------------------
# En algunos PCs con Windows la conexión IPv6 está "a medias": Python intenta
# IPv6 primero y se queda esperando hasta el timeout (por eso el clima tardaba
# ~40 s y fallaba). Aquí probamos primero IPv4, que siempre funciona.
_getaddrinfo_original = socket.getaddrinfo


def _ipv4_primero(*args, **kwargs):
    resultados = _getaddrinfo_original(*args, **kwargs)
    return sorted(resultados, key=lambda r: r[0] != socket.AF_INET)


socket.getaddrinfo = _ipv4_primero

ESPERA_RED_S = 7  # nunca dejar a Byte "pensando" más de unos segundos por una página


def _pedir_json(url: str, parametros: dict, intentos: int = 2) -> dict:
    ultimo = None
    for _ in range(intentos):
        try:
            peticion = urllib.request.Request(
                url + "?" + urllib.parse.urlencode(parametros),
                headers={"User-Agent": "Byte/1.0 (asistente de escritorio)"},
            )
            with urllib.request.urlopen(peticion, timeout=ESPERA_RED_S) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001 - reintentamos cualquier fallo de red
            ultimo = e
            time.sleep(0.5)
    raise ultimo


# Ciudades frecuentes: así no hay que buscar sus coordenadas cada vez.
LUGARES_CONOCIDOS = {
    "bogota": {"name": "Bogotá", "admin1": "Bogotá D.C.", "country": "Colombia", "latitude": 4.711, "longitude": -74.0721},
    "medellin": {"name": "Medellín", "admin1": "Antioquia", "country": "Colombia", "latitude": 6.2518, "longitude": -75.5636},
    "cali": {"name": "Cali", "admin1": "Valle del Cauca", "country": "Colombia", "latitude": 3.4372, "longitude": -76.5225},
    "barranquilla": {"name": "Barranquilla", "admin1": "Atlántico", "country": "Colombia", "latitude": 10.9639, "longitude": -74.7964},
    "cartagena": {"name": "Cartagena", "admin1": "Bolívar", "country": "Colombia", "latitude": 10.391, "longitude": -75.4794},
}
_cache_clima: dict = {}  # ciudad -> (hora, respuesta); se reutiliza 10 minutos


def _sin_tildes(texto: str) -> str:
    import unicodedata

    t = unicodedata.normalize("NFD", (texto or "").lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    for sobra in (", colombia", " colombia", " d.c.", " dc"):
        t = t.replace(sobra, "")
    return t.strip()


def _buscar_lugar(ciudad: str):
    clave = _sin_tildes(ciudad) or "bogota"
    if clave in LUGARES_CONOCIDOS:
        return LUGARES_CONOCIDOS[clave]
    lugares = _pedir_json(
        "https://geocoding-api.open-meteo.com/v1/search",
        {"name": ciudad, "count": 1, "language": "es"},
    ).get("results") or []
    return lugares[0] if lugares else None


def _clima_open_meteo(lugar: dict) -> dict:
    datos = _pedir_json(
        "https://api.open-meteo.com/v1/forecast",
        {
            "latitude": lugar["latitude"],
            "longitude": lugar["longitude"],
            "current": "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m",
            "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
            "timezone": "auto",
            "forecast_days": 2,
        },
    )
    ahora, dias = datos["current"], datos["daily"]
    pronostico = []
    for i, nombre in enumerate(["hoy", "mañana"]):
        pronostico.append({
            "dia": nombre,
            "cielo": CIELO.get(dias["weather_code"][i], "variable"),
            "maxima_c": round(dias["temperature_2m_max"][i]),
            "minima_c": round(dias["temperature_2m_min"][i]),
            "probabilidad_lluvia": f'{dias["precipitation_probability_max"][i]}%',
        })
    return {
        "ahora": {
            "temperatura_c": round(ahora["temperature_2m"]),
            "sensacion_c": round(ahora["apparent_temperature"]),
            "humedad": f'{ahora["relative_humidity_2m"]}%',
            "cielo": CIELO.get(ahora["weather_code"], "variable"),
            "viento_kmh": round(ahora["wind_speed_10m"]),
        },
        "pronostico": pronostico,
        "fuente": "Open-Meteo",
    }


def _clima_wttr(lugar: dict) -> dict:
    """Plan B si Open-Meteo no contesta: wttr.in (también gratis y sin clave)."""
    datos = _pedir_json(f'https://wttr.in/{lugar["latitude"]},{lugar["longitude"]}', {"format": "j1", "lang": "es"})
    ahora = datos["current_condition"][0]
    desc = (ahora.get("lang_es") or ahora.get("weatherDesc") or [{"value": "variable"}])[0]["value"]
    pronostico = []
    for i, nombre in enumerate(["hoy", "mañana"]):
        d = datos["weather"][i]
        lluvia = max(int(h.get("chanceofrain", 0)) for h in d.get("hourly", [{"chanceofrain": 0}]))
        pronostico.append({"dia": nombre, "maxima_c": int(d["maxtempC"]), "minima_c": int(d["mintempC"]),
                           "probabilidad_lluvia": f"{lluvia}%"})
    return {
        "ahora": {"temperatura_c": int(ahora["temp_C"]), "sensacion_c": int(ahora["FeelsLikeC"]),
                  "humedad": f'{ahora["humidity"]}%', "cielo": desc.lower(), "viento_kmh": int(ahora["windspeedKmph"])},
        "pronostico": pronostico,
        "fuente": "wttr.in",
    }


def consultar_clima(ciudad: str) -> dict:
    ciudad = (ciudad or "").strip() or "Bogotá"
    clave = _sin_tildes(ciudad)
    guardado = _cache_clima.get(clave)
    if guardado and time.time() - guardado[0] < 600:
        return guardado[1]
    try:
        lugar = _buscar_lugar(ciudad)
    except Exception as e:  # noqa: BLE001
        logger.warning(f"Clima: no pude buscar la ciudad {ciudad}: {e}")
        return {"error": "No pude conectarme al servicio del clima. Pide que lo intenten en un momento."}
    if not lugar:
        return {"error": f"No encontré la ciudad {ciudad}"}
    respuesta = None
    for proveedor in (_clima_open_meteo, _clima_wttr):
        try:
            respuesta = proveedor(lugar)
            break
        except Exception as e:  # noqa: BLE001
            logger.warning(f"Clima: falló {proveedor.__name__}: {e}")
    if respuesta is None:
        return {"error": "Los servicios del clima no contestan ahora. Pide que lo intenten en un momento."}
    respuesta = {"lugar": ", ".join(x for x in [lugar.get("name"), lugar.get("admin1"), lugar.get("country")] if x), **respuesta}
    _cache_clima[clave] = (time.time(), respuesta)
    return respuesta


@mcp.tool()
def clima(ciudad: str) -> dict:
    """Da el clima actual y el pronóstico de hoy y mañana de una ciudad
    (temperatura en °C, cielo, probabilidad de lluvia). Si no dicen ciudad, usa Bogotá."""
    logger.info(f"Clima: {ciudad}")
    return consultar_clima(ciudad)


# Spotify (opcional): se carga solo si ya corriste activar-spotify.ps1
try:
    import byte_spotify

    if byte_spotify.listo():
        byte_spotify.registrar(mcp)
        logger.info("Herramientas de Spotify cargadas")
except Exception:
    logger.exception("No pude cargar Spotify; sigo sin él")


PUERTO = 8805

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    if "--probar-clima" in sys.argv:
        # Prueba rápida: python byte_internet.py --probar-clima
        inicio = time.time()
        print(json.dumps(consultar_clima("Bogotá"), ensure_ascii=False, indent=2))
        print(f"Tardó {time.time() - inicio:.1f} s")
        sys.exit(0)
    if "--stdio" in sys.argv:
        mcp.run(transport="stdio")
    else:
        # Solo escucha en este PC (127.0.0.1): Docker Desktop lo alcanza con
        # host.docker.internal, pero otros equipos de la red no.
        mcp.run(transport="http", host="127.0.0.1", port=PUERTO, path="/mcp")
