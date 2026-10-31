"""Herramientas de internet para Byte: buscar, noticias y clima.

Es un servidor MCP: le ofrece "herramientas" a la IA de Byte en la nube.
Cuando le preguntas algo actual ("¿qué pasó hoy con...?", "¿va a llover
en Bogotá?"), la IA decide usar una de estas herramientas, este programa
la ejecuta en tu PC y le devuelve el resultado para que te responda.

No necesita claves: la búsqueda usa DuckDuckGo y el clima, Open-Meteo.

Se conecta al agente con mcp_pipe.py (de github.com/78/mcp-calculator):
    python mcp_pipe.py byte_internet.py
con la dirección del agente en MCP_ENDPOINT (archivo .env).
"""

import json
import logging
import sys
import urllib.parse
import urllib.request

from fastmcp import FastMCP

if sys.platform == "win32":
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


def _pedir_json(url: str, parametros: dict) -> dict:
    with urllib.request.urlopen(url + "?" + urllib.parse.urlencode(parametros), timeout=15) as r:
        return json.load(r)


@mcp.tool()
def clima(ciudad: str) -> dict:
    """Da el clima actual y el pronóstico de hoy y mañana de una ciudad
    (temperatura en °C, cielo, probabilidad de lluvia). Si no dicen ciudad, usa Bogotá."""
    logger.info(f"Clima: {ciudad}")
    lugares = _pedir_json(
        "https://geocoding-api.open-meteo.com/v1/search",
        {"name": ciudad, "count": 1, "language": "es"},
    ).get("results") or []
    if not lugares:
        return {"error": f"No encontré la ciudad {ciudad}"}
    lugar = lugares[0]
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
        "lugar": ", ".join(x for x in [lugar.get("name"), lugar.get("admin1"), lugar.get("country")] if x),
        "ahora": {
            "temperatura_c": round(ahora["temperature_2m"]),
            "sensacion_c": round(ahora["apparent_temperature"]),
            "humedad": f'{ahora["relative_humidity_2m"]}%',
            "viento_kmh": round(ahora["wind_speed_10m"]),
            "cielo": CIELO.get(ahora["weather_code"], "variable"),
        },
        "pronostico": pronostico,
    }


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    mcp.run(transport="stdio")
