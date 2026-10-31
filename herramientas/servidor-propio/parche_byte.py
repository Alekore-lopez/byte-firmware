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
5. Memoria en español (mem_local_short trae su instrucción en chino).
6. Oído más preciso: Whisper con temperature 0, una pista en español y un
   filtro para las frases fantasma ("Subtítulos de Amara.org", "Gracias por
   ver") que inventa cuando le llega un pedazo de audio casi en silencio.
"""

import re
from pathlib import Path

RAIZ = Path("/opt/xiaozhi-esp32-server")


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

# 5) Memoria en español (mem_local_short trae su instrucción en chino)
MEMORIA_ES = '''short_term_memory_prompt = """
Eres el cuaderno de memoria de Byte, un asistente de voz de una casa en Colombia.
Lee la conversación nueva y la memoria anterior, y devuelve la memoria COMPLETA y ACTUALIZADA, en español.

Qué guardar: solo datos útiles y duraderos sobre las personas de la casa (Alecore, Paula u otras):
nombres, gustos, fechas importantes, rutinas, planes, pendientes y cosas que pidieron recordar.
Qué no guardar: saludos, chistes, clima, noticias, música que sonó ni detalles de la conversación sin valor futuro.
Si un dato cambió, deja solo el nuevo. Si algo ya pasó y no sirve, bórralo. Nunca inventes datos.
Mantén la memoria corta: máximo 900 caracteres en total.

Responde SOLO con un bloque JSON válido, sin explicaciones, con esta forma
(los textos de ejemplo NO son datos reales, no los copies):
```json
{
  "personas": {"Alecore": ["dato"], "Paula": ["dato"]},
  "fechas": ["evento: fecha"],
  "pendientes": ["cosa por recordar"],
  "gustos": ["persona: gusto"]
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


parchar("core/providers/memory/mem_local_short/mem_local_short.py", "cuaderno de memoria de Byte", memoria)


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
