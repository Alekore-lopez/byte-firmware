"""Pantalla de Byte en vivo para py-xiaozhi.

Sirve la pantalla de Byte (la misma del simulador) en http://127.0.0.1:8765
y le manda, al instante, lo que pasa en la conversación: si Byte escucha o
habla, lo que entendió, su emoción y cada frase que dice. Es lo mismo que
recibe la placa desde la nube, así que la pantalla se comporta como la real.

Tocar la cara empieza a conversar o corta lo que esté pasando.

Byte Desk (la app de escritorio) también usa este servidor: si el programa
está abierto, Byte Desk le pasa lo que escribes (POST /preguntar) y Byte
contesta aquí con su voz y su cara; Byte Desk lee la respuesta de /events.

Si existe la carpeta byte-internet (herramientas de búsqueda, noticias y
clima), también la arranca en segundo plano y la cierra al salir. Lo que
escribe queda en byte-internet\registro.txt.

Solo escucha en 127.0.0.1 (este PC) y solo le responde a su propia página.
py_xiaozhi_es.py copia este archivo a src/plugins/ y lo conecta en ui.py.
"""

import asyncio
import json
import os
import pathlib
import subprocess
import sys

from aiohttp import web

from src.logging import get_logger

logger = get_logger()

PUERTO = 8765
URL = f"http://127.0.0.1:{PUERTO}"
PAGINA = pathlib.Path(__file__).resolve().parent / "byte_pantalla.html"
ICONO = pathlib.Path(os.environ.get("LOCALAPPDATA", "")) / "Byte" / "byte.ico"
INTERNET = pathlib.Path.home() / "byte-internet"


class PantallaByte:
    def __init__(self, on_tap, on_texto=None):
        self._on_tap = on_tap  # corrutina: tocar la cara
        self._on_texto = on_texto  # corrutina: pregunta escrita desde Byte Desk
        self._clientes: set[asyncio.Queue] = set()
        self._runner: web.AppRunner | None = None
        self._estado = "idle"
        self._internet: subprocess.Popen | None = None

    async def start(self) -> None:
        app = web.Application()
        app.router.add_get("/", self._index)
        app.router.add_get("/events", self._events)
        app.router.add_post("/tap", self._tap)
        app.router.add_get("/estado", self._estado_http)
        app.router.add_post("/preguntar", self._preguntar)
        app.router.add_get("/favicon.ico", self._favicon)
        self._runner = web.AppRunner(app, access_log=None)
        await self._runner.setup()
        try:
            await web.TCPSite(self._runner, "127.0.0.1", PUERTO).start()
        except OSError as e:
            logger.warning(f"Pantalla de Byte: el puerto {PUERTO} está ocupado ({e})")
            await self._runner.cleanup()
            self._runner = None
            return
        logger.info(f"Pantalla de Byte en {URL}")
        abrir_ventana()
        self._internet = arrancar_internet()

    async def stop(self) -> None:
        if self._internet is not None:
            cerrar_internet(self._internet)
            self._internet = None
        for cola in list(self._clientes):
            cola.put_nowait(None)
        if self._runner is not None:
            await self._runner.cleanup()
            self._runner = None

    def estado(self, estado) -> None:
        self._estado = getattr(estado, "value", str(estado))
        self._publicar({"type": "state", "state": self._estado})

    def mensaje(self, msg) -> None:
        if not isinstance(msg, dict):
            return
        tipo = msg.get("type")
        if tipo == "stt":
            self._publicar({"type": "stt", "text": msg.get("text", "")})
        elif tipo == "llm":
            self._publicar({"type": "llm", "emotion": msg.get("emotion", "")})
        elif tipo == "tts":
            self._publicar({"type": "tts", "state": msg.get("state", ""), "text": msg.get("text", "")})

    def _publicar(self, dato: dict) -> None:
        for cola in list(self._clientes):
            try:
                cola.put_nowait(dato)
            except asyncio.QueueFull:
                pass  # una pestaña que no lee no frena a Byte

    @staticmethod
    def _es_propia(request: web.Request) -> bool:
        # Otras páginas web no pueden leer la conversación ni tocar a Byte
        origen = request.headers.get("Origin")
        return origen is None or origen == URL

    async def _index(self, request: web.Request) -> web.StreamResponse:
        return web.FileResponse(PAGINA, headers={"Cache-Control": "no-store"})

    async def _favicon(self, request: web.Request) -> web.StreamResponse:
        if ICONO.exists():
            return web.FileResponse(ICONO)
        raise web.HTTPNotFound()

    async def _tap(self, request: web.Request) -> web.Response:
        if not self._es_propia(request):
            raise web.HTTPForbidden()
        await self._on_tap(self._estado)
        return web.Response(status=204)

    async def _estado_http(self, request: web.Request) -> web.Response:
        """Byte Desk pregunta aquí si el programa está abierto."""
        if not self._es_propia(request):
            raise web.HTTPForbidden()
        return web.json_response({"byte": "pc", "estado": self._estado, "preguntar": self._on_texto is not None})

    async def _preguntar(self, request: web.Request) -> web.Response:
        """Una pregunta escrita en Byte Desk: Byte la contesta con su voz aquí."""
        if not self._es_propia(request) or self._on_texto is None:
            raise web.HTTPForbidden()
        try:
            datos = await request.json()
        except (ValueError, UnicodeDecodeError):
            raise web.HTTPBadRequest()
        texto = str(datos.get("texto", "")).strip()[:2000] if isinstance(datos, dict) else ""
        if not texto:
            raise web.HTTPBadRequest()
        # Se contesta enseguida; Byte habla por su cuenta sin frenar a Byte Desk
        tarea = asyncio.ensure_future(self._on_texto(texto))
        tarea.add_done_callback(_avisar_error)
        return web.Response(status=204)

    async def _events(self, request: web.Request) -> web.StreamResponse:
        if not self._es_propia(request):
            raise web.HTTPForbidden()
        resp = web.StreamResponse(
            headers={"Content-Type": "text/event-stream", "Cache-Control": "no-cache"}
        )
        await resp.prepare(request)
        cola: asyncio.Queue = asyncio.Queue(maxsize=200)
        self._clientes.add(cola)
        try:
            await self._enviar(resp, {"type": "state", "state": self._estado})
            while True:
                try:
                    dato = await asyncio.wait_for(cola.get(), timeout=15)
                except asyncio.TimeoutError:
                    await resp.write(b": sigo aqui\n\n")
                    continue
                if dato is None:
                    break
                await self._enviar(resp, dato)
        except ConnectionResetError:
            pass
        finally:
            self._clientes.discard(cola)
        return resp

    @staticmethod
    async def _enviar(resp: web.StreamResponse, dato: dict) -> None:
        texto = json.dumps(dato, ensure_ascii=False)
        await resp.write(f"data: {texto}\n\n".encode("utf-8"))


def _avisar_error(tarea: asyncio.Future) -> None:
    if not tarea.cancelled() and tarea.exception() is not None:
        logger.warning(f"No pude pasar la pregunta de Byte Desk: {tarea.exception()}")


def abrir_ventana() -> None:
    """Abre la pantalla en una ventana propia de Edge (solo Windows)."""
    if os.name != "nt" or os.environ.get("BYTE_SIN_VENTANA"):
        return
    try:
        subprocess.Popen(
            ["cmd", "/c", "start", "", "msedge", f"--app={URL}", "--window-size=480,400"],
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except OSError as e:
        logger.warning(f"No pude abrir la ventana de la pantalla: {e}. Ábrela en {URL}")


def arrancar_internet() -> subprocess.Popen | None:
    """Arranca las herramientas de internet (byte-internet) si están instaladas."""
    if not ((INTERNET / "mcp_pipe.py").exists() and (INTERNET / "byte_internet.py").exists()):
        return None
    try:
        registro = open(INTERNET / "registro.txt", "w", encoding="utf-8")
        proceso = subprocess.Popen(
            [sys.executable, "mcp_pipe.py", "byte_internet.py"],
            cwd=INTERNET,
            stdout=registro,
            stderr=subprocess.STDOUT,
            # Comparte la ventana negra de Byte.bat: si se cierra, también se cierra esto
        )
    except OSError as e:
        logger.warning(f"No pude arrancar byte-internet: {e}")
        return None
    logger.info("Herramientas de internet arrancadas (byte-internet)")
    return proceso


def cerrar_internet(proceso: subprocess.Popen) -> None:
    """Cierra mcp_pipe.py junto con el byte_internet.py que arrancó."""
    if proceso.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(proceso.pid)],
            capture_output=True,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    else:
        proceso.terminate()
    try:
        proceso.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proceso.kill()
