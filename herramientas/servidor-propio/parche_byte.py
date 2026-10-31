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
