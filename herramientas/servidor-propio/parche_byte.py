"""Arreglos pequeños para la central de Byte (xiaozhi-esp32-server).

docker-compose.yml lo corre DENTRO del contenedor cada vez que arranca,
antes de la central. Cada arreglo revisa si ya está puesto (o si la versión
nueva del servidor ya lo trae) y, si no, lo aplica. Así sobrevive a
reinicios y actualizaciones sin romper nada.

1. Herramientas propias (MCP): la versión 0.9.8 lee `tool.inputSchema`, que ya
   no existe en la librería mcp 2.3 -> "'Tool' object has no attribute
   'inputSchema'". Es el mismo arreglo que hizo el proyecto el 29-oct-2026.
2. Gemini 3 exige una "firma de pensamiento" (thought_signature) en cada
   llamada a herramienta que se le reenvía. La central no la guarda y Gemini
   responde 400. Se agrega la firma comodín que Google documenta para este
   caso, solo cuando el cerebro es Gemini.
3. Oído (Whisper): se le dice que el idioma es español para que no confunda
   palabras con otros idiomas, y se le dan los nombres que debe reconocer.
4. Gemini 3 "piensa" a fondo por defecto (nivel alto), y eso le suma segundos
   a cada respuesta. Para un asistente de voz basta con pensar poco
   (reasoning_effort "low").
5. Memoria en español (mem_local_short trae su instrucción en chino). Desde la
   versión 2 también aprende GUSTOS: música, temas, rutinas, qué hicieron la
   última vez e ideas para proponerte la próxima.
6. Oído más preciso: Whisper con temperature 0, una pista en español y un
   filtro para las frases fantasma ("Subtítulos de Amara.org", "Gracias por
   ver") que inventa cuando le llega un pedazo de audio casi en silencio.
7. Una sola memoria para toda la casa: lo que Byte aprende en el PC lo sigue
   sabiendo la placa (antes cada aparato tenía su memoria y la placa empezaba
   en blanco). Además, al resumir lee la música que sonó en Spotify.
8. Saludo al despertar en español ("¡Hola, Byte!") en vez del "嘿，你好呀" de
   fábrica. Con eso Byte saluda y, si recuerda algo, te lo propone.
9. Whisper a veces oye "Suspéndete" en inglés ("Suspended", "Suspended Day").
   Se corrige a "Suspéndete." antes de que llegue a Gemini.
"""

import os
import re
from pathlib import Path

# BYTE_RAIZ solo sirve para probar el parche fuera del contenedor.
RAIZ = Path(os.environ.get("BYTE_RAIZ", "/opt/xiaozhi-esp32-server"))


def parchar(ruta, marca, cambiar):
    archivo = RAIZ / ruta
    if not archivo.exists():
        print(f"[parche_byte] no existe {ruta}, lo salto")
        return
    texto = archivo.read_text(encoding="utf-8")
    if marca in texto:
        print(f"[parche_byte] {ruta}: ya estaba")
        return
    nuevo = cambiar(texto)
    if nuevo == texto:
        print(f"[parche_byte] {ruta}: no encontré qué cambiar (puede que ya venga arreglado)")
        return
    archivo.write_text(nuevo, encoding="utf-8")
    print(f"[parche_byte] {ruta}: arreglado")


# 1) inputSchema -> input_schema
parchar(
    "core/providers/tools/server_mcp/mcp_client.py",
    'getattr(tool, "input_schema"',
    lambda t: t.replace(
        '"parameters": tool.inputSchema,',
        '"parameters": getattr(tool, "input_schema", None) or getattr(tool, "inputSchema", {}),',
    ),
)

# 2) Firma de pensamiento para Gemini
FIRMA = '''

def _byte_firmas_gemini(cliente, dialogo):
    """Agrega la firma comodín de Gemini a las llamadas a herramientas reenviadas."""
    if "googleapis.com" not in str(getattr(cliente, "base_url", "")):
        return dialogo
    salida = []
    for m in dialogo:
        if isinstance(m, dict) and m.get("role") == "assistant" and m.get("tool_calls"):
            m = dict(m)
            llamadas = []
            for tc in m["tool_calls"]:
                if isinstance(tc, dict) and "extra_content" not in tc:
                    tc = dict(tc)
                    tc["extra_content"] = {"google": {"thought_signature": "skip_thought_signature_validator"}}
                llamadas.append(tc)
            m["tool_calls"] = llamadas
        salida.append(m)
    return salida
'''


def firma(t):
    nuevo, n = re.subn(
        r"(def response_with_functions\(self, session_id, dialogue, functions=None[^)]*\):\n)",
        r"\1        dialogue = _byte_firmas_gemini(self.client, dialogue)\n",
        t,
        count=1,
    )
    return nuevo + FIRMA if n else t


parchar("core/providers/llm/openai/openai.py", "_byte_firmas_gemini", firma)

# 3) Whisper en español
parchar(
    "core/providers/asr/openai.py",
    '"language": "es"',
    lambda t: re.sub(
        r'data = \{\s*"model": self\.model\s*\}',
        'data = {"model": self.model, "language": "es", "prompt": "Byte, Alecore, Paula."}',
        t,
        count=1,
    ),
)

# 4) Gemini piensa poco (más rápido)
parchar(
    "core/providers/llm/openai/openai.py",
    '"googleapis.com": {"reasoning_effort"',
    lambda t: t.replace(
        "THINKING_DISABLED_DOMAINS = {\n",
        'THINKING_DISABLED_DOMAINS = {\n    "googleapis.com": {"reasoning_effort": "low"},\n',
        1,
    ),
)

# 5) Memoria en español (mem_local_short trae su instrucción en chino).
#    Versión 2: además de datos, aprende gustos y deja ideas para proponer.
MEMORIA_ES = '''short_term_memory_prompt = """
Eres el cuaderno de memoria de Byte (versión 2), un asistente de voz de una casa en Colombia.
Lee la conversación nueva, la música que sonó y la memoria anterior, y devuelve la memoria COMPLETA y ACTUALIZADA, en español.
Tu objetivo: que Byte conozca cada vez mejor a las personas de la casa (Alecore, Paula u otras) y pueda proponerles cosas.

Qué guardar:
- personas: datos duraderos (a qué se dedica, mascotas, familia, proyectos).
- gustos: música (artistas, géneros, playlists), temas que le interesan, comida, series, cómo le gusta que Byte le hable.
  Si pidió algo dos o más veces, o dijo "me encanta", es un gusto. Si dijo que algo no le gusta, guárdalo como "no le gusta".
- rutinas: costumbres con día u hora (ej. "Alecore: pone música para trabajar en la tarde").
- fechas: cumpleaños, citas, eventos, con su fecha.
- pendientes: cosas que pidió recordar o que quedaron por hacer.
- ultima_vez: una frase con la fecha de lo principal que hicieron en esta conversación (música que sonó, tema que hablaron).
- para_proponer: 1 a 3 ideas CONCRETAS que Byte puede ofrecer al saludar la próxima vez, cada una con su fecha
  (ej. "seguir la playlist Rock en español que puso el 31-oct", "preguntar cómo le fue en el parcial del 3-nov").
Qué no guardar: saludos, chistes, clima, noticias del día, claves, contraseñas, números de cuenta ni datos de salud delicados.

Reglas:
- Escribe las fechas como día-mes corto (31-oct) usando la fecha de ahora que te doy al final. Nunca escribas "ayer" u "hoy".
- Si un dato cambió, deja solo el nuevo. Si algo ya pasó o lleva más de 7 días en para_proponer, bórralo.
- Si Alecore pidió explícitamente "recuerda que...", guárdalo sí o sí.
- Si pidió "olvida que..." u "olvida eso", bórralo de la memoria.
- Nunca inventes datos ni mezcles personas: si no sabes quién lo dijo, es de Alecore.
- Mantén la memoria corta: máximo 1500 caracteres en total. Si no cabe, quita lo más viejo y menos útil.

Responde SOLO con un bloque JSON válido, sin explicaciones, con esta forma
(los textos de ejemplo NO son datos reales, no los copies):
```json
{
  "personas": {"Alecore": ["dato"], "Paula": ["dato"]},
  "gustos": {"musica": ["Alecore: dato"], "temas": ["Alecore: dato"], "otros": ["Paula: dato"]},
  "rutinas": ["persona: costumbre y hora"],
  "fechas": ["evento: fecha"],
  "pendientes": ["cosa por recordar"],
  "ultima_vez": "fecha: qué hicieron",
  "para_proponer": ["idea concreta (fecha)"]
}
```
"""
'''


def memoria(t):
    inicio = t.find('short_term_memory_prompt = """')
    if inicio < 0:
        return t
    fin = t.find('"""', inicio + len('short_term_memory_prompt = """'))
    if fin < 0:
        return t
    return t[:inicio] + MEMORIA_ES + t[fin + 3:]


parchar("core/providers/memory/mem_local_short/mem_local_short.py", "cuaderno de memoria de Byte (versión 2)", memoria)


# 6) Oído más preciso: Whisper sin "creatividad" (temperature 0), una pista en
#    español de cómo hablas, y filtro de las frases fantasma que Whisper inventa
#    cuando le llega un pedacito de audio casi en silencio.
WHISPER_VIEJO = '"prompt": "Byte, Alecore, Paula."}'
WHISPER_NUEVO = (
    '"prompt": "Hola Byte. Conversación en español de Colombia entre Byte, '
    'Alecore y Paula.", "temperature": "0"}'
)
FANTASMAS = '''
_BYTE_FANTASMAS = (
    "amara.org", "subtítulos", "subtitulos", "gracias por ver",
    "suscríbete", "suscribete", "gracias por su atención",
)


def _byte_sin_fantasmas(texto):
    """Whisper a veces 'oye' frases de YouTube en el silencio. Las descartamos."""
    limpio = (texto or "").strip()
    bajo = limpio.lower()
    if len(bajo) < 2 or any(f in bajo for f in _BYTE_FANTASMAS):
        return ""
    return limpio
'''


def whisper_preciso(t):
    t = t.replace(WHISPER_VIEJO, WHISPER_NUEVO, 1)
    t = t.replace(
        'text = response.json().get("text", "")',
        'text = _byte_sin_fantasmas(response.json().get("text", ""))',
        1,
    )
    if "_byte_sin_fantasmas(response" not in t:
        return t
    return t.rstrip() + "\n\n" + FANTASMAS


parchar("core/providers/asr/openai.py", "_BYTE_FANTASMAS", whisper_preciso)


# 7) Una sola memoria para toda la casa + la música reciente de Spotify.
#    La central guardaba la memoria con el número de cada aparato (device_id),
#    así que la placa iba a empezar en blanco. Ahora todo se guarda bajo
#    "byte-casa". La primera vez copia la memoria más completa que ya exista
#    (la del PC), para que la placa llegue sabiendo todo.
#    byte_spotify.py anota lo que suena en data/.musica_reciente.json y aquí
#    se le pasa al resumen para que Byte sepa qué playlist pusiste ayer.
MEMORIA_CASA = '''

_BYTE_CLAVE_CASA = "byte-casa"


def _byte_clave_casa(toda):
    """Clave única de la casa. Si aún no existe, hereda la memoria más completa."""
    if _BYTE_CLAVE_CASA not in toda and toda:
        mejor = max(toda.values(), key=lambda v: len(str(v or "")))
        if mejor:
            toda[_BYTE_CLAVE_CASA] = mejor
    return _BYTE_CLAVE_CASA


def _byte_musica_reciente():
    """Las últimas canciones o playlists que Byte puso en Spotify (si hay)."""
    ruta = os.path.join(get_project_dir(), "data", ".musica_reciente.json")
    try:
        with open(ruta, "r", encoding="utf-8") as f:
            lista = json.load(f)
    except Exception:
        return ""
    lineas = []
    for m in lista[-6:]:
        if isinstance(m, dict) and m.get("nombre"):
            de = f" de {m['de']}" if m.get("de") else ""
            lineas.append(f"- {m.get('cuando', '')}: {m.get('tipo', '')} {m['nombre']}{de}")
    if not lineas:
        return ""
    return "\\nMúsica que Byte puso en Spotify:\\n" + "\\n".join(lineas) + "\\n"
'''


def memoria_casa(t):
    viejo_leer = "if self.role_id in all_memory:\n            self.short_memory = all_memory[self.role_id]"
    nuevo_leer = (
        "clave = _byte_clave_casa(all_memory)\n"
        "        if clave in all_memory:\n"
        "            self.short_memory = all_memory[clave]"
    )
    viejo_guardar = "all_memory[self.role_id] = self.short_memory"
    nuevo_guardar = "all_memory[_byte_clave_casa(all_memory)] = self.short_memory"
    viejo_hora = "        # 当前时间\n"
    nuevo_hora = "        msgStr += _byte_musica_reciente()\n        # 当前时间\n"
    if viejo_leer not in t or viejo_guardar not in t or viejo_hora not in t:
        return t
    t = t.replace(viejo_leer, nuevo_leer, 1).replace(viejo_guardar, nuevo_guardar, 1)
    t = t.replace(viejo_hora, nuevo_hora, 1)
    # Las etiquetas que ve Gemini, en español
    t = t.replace('msgStr += "历史记忆：\\n"', 'msgStr += "Memoria anterior:\\n"', 1)
    t = t.replace('msgStr += f"当前时间：{time_str}"', 'msgStr += f"\\nFecha y hora de ahora: {time_str}"', 1)
    return t.rstrip() + "\n" + MEMORIA_CASA


parchar("core/providers/memory/mem_local_short/mem_local_short.py", "_BYTE_CLAVE_CASA", memoria_casa)


# 8) Saludo al despertar en español. Cuando dices "Byte", la central le pasa
#    al cerebro un saludo de mentiras para que conteste; venía en chino.
parchar(
    "core/handle/textHandler/listenMessageHandler.py",
    "¡Hola, Byte!",
    lambda t: t.replace('"嘿，你好呀"', '"¡Hola, Byte!"'),
)


# 9) Whisper a veces oye "Suspéndete" en inglés ("Suspended", "Suspended Day")
#    y entonces Byte no se duerme. Lo corregimos antes de que llegue al cerebro;
#    así Byte se despide como siempre y guarda la memoria.
CORREGIR = '''

_BYTE_CORRECCIONES = {
    "suspended": "Suspéndete.", "suspendedday": "Suspéndete.", "suspend": "Suspéndete.",
    "suspendit": "Suspéndete.", "suspendedte": "Suspéndete.",
}


def _byte_corregir(texto):
    """Cambia lo que Whisper oye mal siempre igual por lo que quisiste decir."""
    clave = "".join(c for c in (texto or "").lower() if c.isalpha())
    for nombre in ("byte", "byt", "bait"):
        if clave.startswith(nombre) and len(clave) > len(nombre):
            clave = clave[len(nombre):]
            break
    return _BYTE_CORRECCIONES.get(clave, texto)
'''


def corregir(t):
    viejo = 'text = _byte_sin_fantasmas(response.json().get("text", ""))'
    if viejo not in t:
        return t
    t = t.replace(viejo, 'text = _byte_corregir(_byte_sin_fantasmas(response.json().get("text", "")))', 1)
    return t.rstrip() + "\n" + CORREGIR


parchar("core/providers/asr/openai.py", "_BYTE_CORRECCIONES", corregir)
