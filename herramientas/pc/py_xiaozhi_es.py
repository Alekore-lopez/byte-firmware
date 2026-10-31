"""Pone en español la ventana de py-xiaozhi y hace que converse sola al abrir.

py-xiaozhi (github.com/huangjunsen0406/py-xiaozhi) es un cliente de XiaoZhi
para el PC: sirve para hablar con el agente de Byte sin tener la placa.
Su interfaz viene solo en chino, así que este script:

  1. Cambia los textos de la ventana (botones, ajustes, avisos) por español.
     Los mensajes de la terminal (registro) siguen en chino.
  2. Activa el modo automático al abrir y empieza a escuchar, sin tocar
     botones.
  3. Hace el audio más estable en Windows: búferes de sonido más grandes
     (evitan chasquidos y cortes), trozos de audio de 60 ms como la placa,
     y espacio para respuestas largas (antes se perdía lo que pasaba de 10 s).
  4. En modo automático deja que la respuesta termine de sonar antes de
     volver a escuchar (antes se cortaba el final de cada respuesta).
  5. Abre la Pantalla de Byte en vivo: la cara de Byte cambia y muestra lo
     que dice, como en la placa (byte_pantalla.py + byte_pantalla.html).
     La ventana vieja de py-xiaozhi arranca escondida: se abre con Ctrl+W
     o desde el ícono junto al reloj ("Mostrar ventana").
     También arranca las herramientas de internet (carpeta byte-internet).
  6. Deja Byte.bat en el escritorio para abrir todo con doble clic.

Se puede correr varias veces sin problema. Para deshacerlo:
    git checkout .     (dentro de la carpeta py-xiaozhi)

Uso, dentro de la carpeta py-xiaozhi:
    python py_xiaozhi_es.py
"""

import json
import pathlib
import sys
import urllib.request

# De aquí se bajan los archivos de la pantalla en vivo
RAMA = "https://raw.githubusercontent.com/Alekore-lopez/byte-firmware/claude/project-thread-p61eh2/herramientas/pc/"

# Chino -> español. Se reemplazan primero los textos más largos para que
# las palabras sueltas ("测试") no rompan frases que las contienen.
TEXTOS = {
    # Ventana principal y estados
    "待命": "En espera",
    "聆听中...": "Escuchando...",
    "说话中...": "Hablando...",
    "通知播放中...": "Avisando...",
    "正在播放: {song}": "Reproduciendo: {song}",
    "已暂停: {song}": "En pausa: {song}",
    "已停止: {song}": "Detenido: {song}",
    "播放完成: {song}": "Terminó: {song}",
    "播放失败: {song}": "No se pudo reproducir: {song}",
    "未连接": "Sin conexión",
    "按住后说话": "Mantén para hablar",
    "停止对话": "Detener",
    "开始对话": "Empezar",
    "发送": "Enviar",
    "手动对话": "Modo manual",
    "自动对话": "Modo automático",
    "打断对话": "Interrumpir",
    "输入文字...": "Escribe aquí...",
    "参数设置": "Ajustes",
    "等待对话...": "Esperando conversación...",
    "输入文本消息...": "Escribe un mensaje...",
    "切换到手动": "Cambiar a manual",
    "切换到自动": "Cambiar a automático",
    "中断": "Interrumpir",
    "显示窗口": "Mostrar ventana",
    "退出": "Salir",
    # Activación
    "未激活": "Sin activar",
    "激活中...": "Activando...",
    "已激活": "Activado",
    "需重新激活": "Hay que activar de nuevo",
    "已自动修复": "Reparado automáticamente",
    "检查中...": "Revisando...",
    "设备激活": "Activar dispositivo",
    "设备信息": "Información del dispositivo",
    "设备序列号": "Número de serie",
    "MAC 地址": "Dirección MAC",
    "激活验证码": "Código de activación",
    "复制": "Copiar",
    "打开激活页面": "Abrir página de activación",
    "设备已激活，窗口即将关闭...": "Dispositivo activado, la ventana se cerrará...",
    "请在激活页面输入验证码完成设备激活": "Escribe el código en la consola de xiaozhi.me para activar el dispositivo",
    "验证码已复制": "Código copiado",
    # Ventana de ajustes
    "系统选项": "Sistema",
    "MCP 工具": "Herramientas MCP",
    "摄像头": "Cámara",
    "音频设备": "Audio",
    "快捷键": "Atajos",
    "音乐": "Música",
    "重置": "Restablecer",
    "取消": "Cancelar",
    "保存": "Guardar",
    "配置已保存（MCP 工具变更，将重连以更新）": "Ajustes guardados (cambiaron las herramientas MCP, se reconectará)",
    "配置已保存": "Ajustes guardados",
    "保存配置失败: {e}": "No se pudieron guardar los ajustes: {e}",
    "[错误] {e}": "[Error] {e}",
    # Audio
    "加载了 {len(self._input_devices)} 个输入设备, ": "Se cargaron {len(self._input_devices)} entradas, ",
    "{len(self._output_devices)} 个输出设备": "{len(self._output_devices)} salidas",
    "设备刷新进行中…": "Actualizando dispositivos…",
    "设备列表已刷新（未协调音频流；后连蓝牙可能仍不可见）": "Lista actualizada (un Bluetooth recién conectado puede no aparecer)",
    "正在刷新音频设备（会短暂中断麦克风/播放）…": "Actualizando audio (el micrófono y el sonido se cortan un momento)…",
    "设备列表已刷新（输入 {n_in} / 输出 {n_out}）": "Lista actualizada (entradas {n_in} / salidas {n_out})",
    "应用正在关闭，已本地枚举": "La aplicación se está cerrando; lista local",
    "设备刷新失败，已本地枚举: {e}": "No se pudo actualizar, lista local: {e}",
    "采样率: {d['sample_rate']}Hz, 通道: {d['channels']}": "Frecuencia: {d['sample_rate']}Hz, canales: {d['channels']}",
    "未选择设备": "Ningún dispositivo elegido",
    "请先选择输入设备": "Primero elige el micrófono",
    "开始录音测试...": "Probando el micrófono...",
    "请对着麦克风说话 ({duration}秒)...": "Habla al micrófono ({duration} segundos)...",
    "[失败] 未检测到音频信号": "[Falla] No se detectó sonido",
    "[警告] 音频信号过载": "[Aviso] El sonido está saturado",
    "[成功] 录音测试通过 (音量: {max_amplitude:.1%})": "[OK] El micrófono funciona (volumen: {max_amplitude:.1%})",
    "请先选择输出设备": "Primero elige el parlante",
    "开始播放测试...": "Probando el parlante...",
    "播放 440Hz 测试音...": "Sonando tono de prueba de 440 Hz...",
    "[成功] 播放测试完成": "[OK] El parlante funciona",
    "设备列表已加载": "Lista de dispositivos cargada",
    "设备列表已刷新": "Lista de dispositivos actualizada",
    "刷新设备": "Actualizar",
    "输入设备 (麦克风)": "Entrada (micrófono)",
    "测试中...": "Probando...",
    "测试": "Probar",
    "输出设备 (扬声器)": "Salida (parlante)",
    "Opus 输出采样率已设置为 ": "Frecuencia de salida Opus: ",
    "Opus 输出采样率": "Frecuencia de salida Opus",
    "24000 Hz (官方服务器)": "24000 Hz (servidor oficial)",
    "16000 Hz (第三方服务器)": "16000 Hz (otros servidores)",
    "官方服务器使用 24kHz，第三方服务器通常使用 16kHz": "El servidor oficial usa 24 kHz; otros servidores suelen usar 16 kHz",
    "音频帧长度已设置为 ": "Duración de cada trozo de audio: ",
    "音频帧长度": "Duración de cada trozo de audio",
    "20 ms (低延迟)": "20 ms (más rápido)",
    "40 ms (平衡)": "40 ms (equilibrado)",
    "60 ms (低CPU)": "60 ms (menos CPU)",
    "20ms 低延迟高CPU，60ms 高延迟低CPU（适合树莓派）": "20 ms responde más rápido pero usa más CPU; 60 ms usa menos CPU (Raspberry Pi)",
    "点击测试按钮验证设备是否正常工作。输入测试会录制 3 秒音频，输出测试会播放 440Hz 测试音。": "Toca Probar para revisar cada dispositivo. El micrófono graba 3 segundos y el parlante suena un tono de 440 Hz.",
    "状态日志": "Registro",
    "清除日志": "Borrar registro",
    "日志已清除": "Registro borrado",
    # Cámara
    "摄像头列表已刷新（{len(cameras)} 个）": "Cámaras actualizadas ({len(cameras)})",
    "未检测到摄像头（Pi CSI 需安装 picamera2）": "No se encontró ninguna cámara",
    "没有可用的摄像头": "No hay cámaras disponibles",
    "请先选择摄像头": "Primero elige una cámara",
    "正在测试摄像头 {camera['name']}...": "Probando la cámara {camera['name']}...",
    "[失败] 无法捕获图像（Pi CSI 请装 python3-picamera2 或改选 USB）": "[Falla] No se pudo tomar la imagen",
    "[成功] 摄像头正常 (JPEG {len(jpeg)} bytes, {camera['name']})": "[OK] La cámara funciona (JPEG {len(jpeg)} bytes, {camera['name']})",
    "摄像头设置": "Cámara",
    "设备选择": "Elegir dispositivo",
    "刷新": "Actualizar",
    "视频参数": "Video",
    "分辨率": "Resolución",
    "帧率": "Cuadros por segundo",
    "视觉语言模型 (VL API)": "Modelo de visión (VL API)",
    "API 地址": "Dirección de la API",
    "模型": "Modelo",
    "正在测试摄像头...": "Probando la cámara...",
    "摄像头用于视觉识别功能。如需使用本地 VL 模型，请配置 API 地址和密钥。": "La cámara sirve para que la IA vea. Para un modelo de visión propio, configura la dirección y la clave de la API.",
    # Estas etiquetas también se comparan en CameraTab.qml: se cambian igual en todos los archivos
    "[成功]": "[OK]",
    "[失败]": "[Falla]",
    "[错误]": "[Error]",
    # Herramientas MCP
    "控制哪些工具暴露给服务端。关闭后不出现在 tools/list，也无法调用。保存后若已连接将自动重连以更新列表。": "Elige qué herramientas puede usar la IA. Las apagadas no se ofrecen al servidor. Al guardar se reconecta.",
    "全开": "Todas",
    "全关": "Ninguna",
    # Música
    "音乐配置": "Música",
    "API 设置": "API",
    "搜索 API": "API de búsqueda",
    "留空使用默认酷我搜索 API": "Vacío = búsqueda por defecto",
    "直链 API": "API de enlaces",
    "留空使用默认 lx-music-api": "Vacío = lx-music-api por defecto",
    "留空使用默认 Key": "Vacío = clave por defecto",
    "搜索 API 使用酷我官方接口，直链 API 用于获取播放地址（需配合 API Key）": "La API de búsqueda encuentra canciones; la de enlaces obtiene el audio (necesita clave)",
    "播放偏好": "Reproducción",
    "默认音质": "Calidad",
    # Atajos
    "快捷键设置": "Atajos de teclado",
    "基本设置": "General",
    "启用全局快捷键": "Activar atajos globales",
    "快捷键配置": "Atajos",
    "按住说话": "Mantener para hablar",
    "长按录音": "Mantén presionado para grabar",
    "开启/关闭自动对话": "Encender o apagar la conversación automática",
    "中断对话": "Interrumpir",
    "立即停止当前对话": "Detiene la conversación actual",
    "切换模式": "Cambiar modo",
    "手动/自动模式切换": "Cambia entre manual y automático",
    "显示/隐藏": "Mostrar u ocultar",
    "切换主窗口可见性": "Muestra u oculta la ventana",
    "快捷键在全局范围内有效，请确保不与系统或其他应用的快捷键冲突。": "Los atajos funcionan en todo Windows; evita que choquen con los de otros programas.",
    # Sistema
    "基本信息": "Información",
    "客户端 ID": "ID de cliente",
    "自动生成": "Automático",
    "设备 ID": "ID del dispositivo",
    "回声消除": "Cancelación de eco",
    "启用": "Activar",
    "音乐并行播放": "Música en paralelo",
    "延迟补偿帧数": "Compensación de retraso",
    "噪声抑制预处理": "Reducción de ruido",
    "消除本应用 TTS/音乐的回声，启用后进入实时对话模式；音乐并行=TTS 播放时音乐闪避不暂停；延迟补偿=40ms+N×协议帧长，蓝牙设备可适当调大。修改后重启生效。": "Quita el eco de la voz y la música para conversar en tiempo real. Con audífonos Bluetooth sube la compensación. Se aplica al reiniciar.",
    "网络配置": "Red",
    "访问令牌": "Token de acceso",
    "OTA 版本 URL": "URL de OTA",
    "授权 URL": "URL de autorización",
    "激活版本": "Versión de activación",
    "MQTT 配置": "MQTT",
    "服务端点": "Servidor",
    "用户名": "Usuario",
    "密码": "Contraseña",
    "发布主题": "Tema de publicación",
    "订阅主题": "Tema de suscripción",
    "数据目录": "Carpetas",
    "配置文件仍在用户数据目录。点「选择」打开系统文件夹对话框；「默认」清空为系统默认。保存后下次启动会从旧目录复制到新路径。": "Los ajustes siempre quedan en la carpeta de usuario. Elegir abre el explorador; Por defecto vuelve a la carpeta normal. Se aplica al reiniciar.",
    "缓存目录": "Caché",
    "选择": "Elegir",
    "默认": "Por defecto",
    "日志目录": "Registros",
    "音乐缓存": "Caché de música",
    "唤醒词目录": "Palabras de activación",
    "MCP 插件目录": "Complementos MCP",
    "数据根(配置固定在此): {data}\\n": "Carpeta de datos (aquí quedan los ajustes): {data}\\n",
    "留空=默认；点「选择」用系统对话框；保存后下次启动迁移": "Vacío = por defecto; se aplica al reiniciar",
    "留空使用默认路径；保存后下次启动迁移": "Vacío = carpeta por defecto; se aplica al reiniciar",
    "选择缓存目录": "Elegir carpeta de caché",
    "选择日志目录": "Elegir carpeta de registros",
    "选择音乐缓存目录": "Elegir carpeta de música",
    "选择唤醒词目录": "Elegir carpeta de palabras de activación",
    "选择 MCP 插件目录": "Elegir carpeta de complementos MCP",
    # Palabra de activación
    "唤醒词设置": "Palabra de activación",
    "启用唤醒词": "Activar palabra de activación",
    "输入唤醒词，如「小智」或「Hey Jarvis」": "Escribe la palabra, por ejemplo HEY BYTE",
    "唤醒词已保存 ({lang.upper()})": "Palabra guardada ({lang.upper()})",
    "保存唤醒词失败: {e}": "No se pudo guardar la palabra: {e}",
    "请输入唤醒词": "Escribe una palabra de activación",
    "转换失败: {e}": "No se pudo convertir: {e}",
    "唤醒词": "Palabra de activación",
    "中文": "Chino",
    "转换预览": "Vista previa",
    "保存唤醒词": "Guardar palabra",
    "检测参数": "Detección",
    "线程数": "Hilos",
    "建议设置为 CPU 核心数": "Pon el número de núcleos de tu CPU",
    "关键词得分": "Puntaje",
    "关键词阈值": "Umbral",
    "支持中文和英文唤醒词。中文会自动转换为拼音格式，英文使用 BPE 分词。得分越高越严格，阈值越低越敏感。": "Acepta palabras en chino o en inglés (en mayúsculas). Más puntaje = más estricto; menos umbral = más sensible.",
}

# Al abrir: pasar a modo automático y empezar a escuchar.
MARCA = "# BYTE: conversar al abrir"
BUSCAR = """        else:
            # GUI start installs its Qt callbacks and returns; terminal/GPIO"""
AGREGAR = f"""        else:
            {MARCA}
            if self.mode == "gui" and self._session is not None:
                if not self._session.auto_mode:
                    await self._session.auto_toggle()
                await asyncio.sleep(1.5)
                await self._session.auto_session_toggle()
            # GUI start installs its Qt callbacks and returns; terminal/GPIO"""


# Audio: (archivo, buscar, reemplazar). Se cambian todas las apariciones.
AUDIO = [
    # "low" pide búferes mínimos a Windows; con algunos micrófonos y parlantes
    # se quedan sin datos y suenan chasquidos o se pierden trozos de voz.
    ("src/audio_codecs/stream_manager.py", 'latency="low"', 'latency="high"'),
    # La nube manda la respuesta más rápido de lo que se reproduce; con 10 s
    # de espacio, en respuestas largas se botaba el comienzo.
    ("src/audio_codecs/audio_codec.py", "_TTS_FIFO_MAX_S = 10.0", "_TTS_FIFO_MAX_S = 120.0"),
]


# Final de la respuesta: cuando la nube avisa "terminé de mandar la voz",
# py-xiaozhi borraba lo que aún no había sonado (el log lo muestra como
# "清空 TTS 队列，丢弃 N 样本"). Ahora espera a que suene todo.
MARCA_FINAL = "# BYTE: dejar terminar la respuesta"
BUSCAR_FINAL = """        # realtime 一般还在 listen 里，不用再发一遍。
"""
AGREGAR_FINAL = f"""        {MARCA_FINAL} antes de volver a escuchar
        fifo = getattr(self.audio, "_tts_fifo", None)
        for _ in range(300):  # máximo 15 s
            if fifo is None or fifo.size == 0 or generation != self._tts_generation:
                break
            await asyncio.sleep(0.05)
        if generation != self._tts_generation:
            return

        # realtime 一般还在 listen 里，不用再发一遍。
"""


# Pantalla en vivo: ui.py arranca el servidor y le pasa estados y mensajes.
MARCA_PANTALLA = "# BYTE: pantalla en vivo"
PANTALLA = [
    (
        "from src.plugins.ui_session import SessionActions\n",
        "from src.plugins.ui_session import SessionActions\n"
        f"from src.plugins.byte_pantalla import PantallaByte  {MARCA_PANTALLA}\n",
    ),
    (
        """        if self._session:
            self._session.subscribe(bus)
""",
        f"""        if self._session:
            self._session.subscribe(bus)

        {MARCA_PANTALLA}
        if self.mode == "gui" and self._session is not None:
            self._pantalla = PantallaByte(self._tocar_cara)
            await self._pantalla.start()
""",
    ),
    (
        """    async def on_incoming_json(self, message) -> None:
""",
        f"""    async def _tocar_cara(self, estado: str) -> None:
        {MARCA_PANTALLA}: tocar la cara empieza a conversar o corta
        if self._session is None:
            return
        if estado == "speaking":
            await self._session.abort()
            return
        if not self._session.auto_mode:
            await self._session.auto_toggle()
        await self._session.auto_session_toggle()

    async def on_incoming_json(self, message) -> None:
        if getattr(self, "_pantalla", None) is not None:
            self._pantalla.mensaje(message)
""",
    ),
    (
        """    async def on_device_state_changed(self, state) -> None:
""",
        """    async def on_device_state_changed(self, state) -> None:
        if getattr(self, "_pantalla", None) is not None:
            self._pantalla.estado(state)
""",
    ),
    (
        """    async def stop(self) -> None:
        self._stopping = True
""",
        """    async def stop(self) -> None:
        self._stopping = True
        if getattr(self, "_pantalla", None) is not None:
            await self._pantalla.stop()
            self._pantalla = None
""",
    ),
]


# La ventana vieja (carita amarilla) ya no hace falta: arranca escondida
MARCA_OCULTA = "# BYTE: ventana vieja escondida"
BUSCAR_OCULTA = """        self._host.show_root(activate=False)
"""
PONER_OCULTA = f"""        {MARCA_OCULTA} (Ctrl+W o el ícono junto al reloj la muestran)
"""


def esconder_ventana_vieja(raiz: pathlib.Path) -> None:
    archivo = raiz / "src" / "ui" / "gui" / "manager.py"
    codigo = archivo.read_text(encoding="utf-8")
    if MARCA_OCULTA in codigo:
        return
    if codigo.count(BUSCAR_OCULTA) == 1:
        archivo.write_text(codigo.replace(BUSCAR_OCULTA, PONER_OCULTA), encoding="utf-8", newline="")
        print("Ventana vieja: ahora arranca escondida (Ctrl+W la muestra).")
    else:
        print("Aviso: src/ui/gui/manager.py cambió y no pude esconder la ventana vieja.")


def bajar(nombre: str, destino: pathlib.Path) -> bool:
    # Si el archivo está junto a este script (repo byte-firmware), se usa ese
    local = pathlib.Path(__file__).resolve().parent / nombre
    if local.exists():
        destino.write_bytes(local.read_bytes())
        return True
    try:
        with urllib.request.urlopen(RAMA + nombre, timeout=30) as r:
            destino.write_bytes(r.read())
        return True
    except OSError as e:
        print(f"Aviso: no pude bajar {nombre} ({e}).")
        return False


def instalar_pantalla(raiz: pathlib.Path) -> None:
    plugins = raiz / "src" / "plugins"
    if not (bajar("byte_pantalla.py", plugins / "byte_pantalla.py") and bajar("byte_pantalla.html", plugins / "byte_pantalla.html")):
        return
    ui = plugins / "ui.py"
    codigo = ui.read_text(encoding="utf-8")
    if MARCA_PANTALLA in codigo:
        print("Pantalla en vivo: actualizada.")
        esconder_ventana_vieja(raiz)
        return
    for buscar, _ in PANTALLA:
        if codigo.count(buscar) != 1:
            print("Aviso: src/plugins/ui.py cambió y no pude conectar la pantalla en vivo.")
            return
    for buscar, poner in PANTALLA:
        codigo = codigo.replace(buscar, poner)
    ui.write_text(codigo, encoding="utf-8", newline="")
    print("Pantalla en vivo: lista. Se abrirá sola al iniciar el programa.")
    esconder_ventana_vieja(raiz)


def crear_bat(raiz: pathlib.Path) -> None:
    """Byte.bat en el escritorio: doble clic y abre todo."""
    if sys.platform != "win32":
        return
    import subprocess

    try:
        escritorio = subprocess.run(
            ["powershell", "-NoProfile", "-Command", "[Environment]::GetFolderPath('Desktop')"],
            capture_output=True, text=True, timeout=30,
        ).stdout.strip()
    except OSError:
        escritorio = ""
    escritorio = pathlib.Path(escritorio or pathlib.Path.home() / "Desktop")
    bat = escritorio / "Byte.bat"
    bat.write_text(
        "@echo off\r\n"
        "title Byte\r\n"
        f'cd /d "{raiz}"\r\n'
        f'"{sys.executable}" main.py\r\n',
        encoding="ascii",
        errors="replace",
    )
    print(f"Listo: {bat} (doble clic para abrir Byte).")


def arreglar_final(raiz: pathlib.Path) -> None:
    archivo = raiz / "src" / "bootstrap" / "session.py"
    codigo = archivo.read_text(encoding="utf-8")
    if MARCA_FINAL in codigo:
        print("Audio: el final de las respuestas ya estaba arreglado.")
    elif codigo.count(BUSCAR_FINAL) == 1:
        archivo.write_text(codigo.replace(BUSCAR_FINAL, AGREGAR_FINAL), encoding="utf-8", newline="")
        print("Audio: ahora las respuestas suenan completas.")
    else:
        print("Aviso: src/bootstrap/session.py cambió y no pude arreglar el final de las respuestas.")


def arreglar_audio(raiz: pathlib.Path) -> None:
    for ruta, buscar, poner in AUDIO:
        archivo = raiz / ruta
        codigo = archivo.read_text(encoding="utf-8")
        if buscar in codigo:
            archivo.write_text(codigo.replace(buscar, poner), encoding="utf-8", newline="")
            print(f"Audio: {ruta} ajustado.")
        elif poner in codigo:
            print(f"Audio: {ruta} ya estaba ajustado.")
        else:
            print(f"Aviso: {ruta} cambió y no pude ajustarlo.")

    # Trozos de 60 ms (lo mismo que usa la placa): menos trabajo para el PC.
    try:
        import platformdirs

        config = pathlib.Path(platformdirs.user_data_dir("py-xiaozhi")) / "config" / "config.json"
    except ImportError:
        config = None
    if config is None or not config.exists():
        print("Aviso: no encontré config.json; abre el programa una vez y vuelve a correr este script.")
        return
    datos = json.loads(config.read_text(encoding="utf-8-sig"))
    audio = datos.setdefault("AUDIO_DEVICES", {})
    if audio.get("frame_duration") != 60:
        audio["frame_duration"] = 60
        config.write_text(json.dumps(datos, ensure_ascii=False, indent=2), encoding="utf-8")
        print("Audio: trozos de 60 ms activados.")
    else:
        print("Audio: los trozos de 60 ms ya estaban activados.")


def main() -> int:
    raiz = pathlib.Path.cwd()
    if not (raiz / "main.py").exists() or not (raiz / "src" / "ui" / "gui").is_dir():
        print("Corre este script dentro de la carpeta py-xiaozhi.")
        return 1

    archivos = sorted(
        set((raiz / "src" / "ui" / "gui").rglob("*.qml"))
        | set((raiz / "src" / "ui" / "gui").rglob("*.py"))
        | {raiz / "src" / "plugins" / "ui_presenter.py", raiz / "src" / "plugins" / "ui_session.py"}
    )
    claves = sorted(TEXTOS, key=len, reverse=True)
    cambiados = 0
    for archivo in archivos:
        texto = archivo.read_text(encoding="utf-8")
        nuevo = texto
        for clave in claves:
            nuevo = nuevo.replace(clave, TEXTOS[clave])
        if nuevo != texto:
            archivo.write_text(nuevo, encoding="utf-8", newline="")
            cambiados += 1
    print(f"Textos traducidos en {cambiados} archivos.")

    ui = raiz / "src" / "plugins" / "ui.py"
    codigo = ui.read_text(encoding="utf-8")
    if MARCA in codigo:
        print("La conversación automática ya estaba activada.")
    elif BUSCAR in codigo:
        ui.write_text(codigo.replace(BUSCAR, AGREGAR, 1), encoding="utf-8", newline="")
        print("Listo: al abrir, empezará a escuchar solo.")
    else:
        print("Aviso: py-xiaozhi cambió y no pude activar la conversación automática.")
        print("Usa el botón Modo manual (pasa a automático) y luego Empezar.")

    arreglar_final(raiz)
    arreglar_audio(raiz)
    instalar_pantalla(raiz)
    crear_bat(raiz)
    return 0


if __name__ == "__main__":
    sys.exit(main())
