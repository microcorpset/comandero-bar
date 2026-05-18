from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any


def _get_exe_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent

def _get_bundle_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS)  # type: ignore[attr-defined]
    return Path(__file__).resolve().parent

EXE_DIR = _get_exe_dir()
BUNDLE_DIR = _get_bundle_dir()
CONFIG_PATH = EXE_DIR / "printer-service-config.json"


def _decode_field(enc: str, key: str = "cmd25k") -> str:
    raw = base64.b64decode(enc).decode("latin-1")
    return "".join(chr(ord(c) ^ ord(key[i % len(key)])) for i, c in enumerate(raw))


def now_text() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def log(message: str) -> None:
    print(f"[{now_text()}] {message}", flush=True)


def safe_service_key(value: str) -> str:
    return re.sub(r"[.#$/\[\]]+", "_", value)


def wrap_text(text: str, max_chars: int) -> list[str]:
    clean = re.sub(r"\s+", " ", str(text or "")).strip()
    if not clean:
        return [""]
    out: list[str] = []
    remaining = clean
    while len(remaining) > max_chars:
        cut = remaining.rfind(" ", 0, max_chars + 1)
        if cut < 1:
            cut = max_chars
        out.append(remaining[:cut].strip())
        remaining = remaining[cut:].strip()
    if remaining:
        out.append(remaining)
    return out


EURO_SYMBOL = "\u20ac"


def _download_logo(url: str) -> str | None:
    if not url:
        return None
    try:
        if url.startswith("data:image/"):
            header, data = url.split(",", 1)
            ext = ".png" if "png" in header else ".jpg"
            img_data = base64.b64decode(data)
            with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
                tmp.write(img_data)
                return tmp.name
        if not url.startswith(("http://", "https://")):
            log(f"Logo: URL no soportada (debe ser http/https o data:image): {url[:60]}")
            return None
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            content_type = resp.getheader("Content-Type", "")
            ext = ".png" if "png" in content_type else ".jpg"
            with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
                tmp.write(resp.read())
                return tmp.name
    except Exception as exc:
        log(f"Logo: no se pudo procesar ({exc})")
        return None


def receipt_layout(paper: str, font_size: float) -> tuple[int, int]:
    # Returns (max_chars, price_width) for TOTAL/header lines.
    # max_chars scales ~inversely with font_size (Consolas GDI+ rendering).
    # Both this function and Get-ReceiptConfig in print-receipt.ps1 must stay in sync.
    # ceil(baseline_chars * baseline_font / font_size) — rounds up so text reaches the right edge.
    # RightMargin (8/100 inch) provides enough buffer to absorb the ~1 char overshoot.
    is_80 = "80" in str(paper or "")
    if is_80:
        if font_size > 11.5: return 28,  9
        if font_size > 10.5: return 31, 10
        if font_size > 9.5:  return 34, 10
        if font_size > 8.5:  return 37, 11
        if font_size > 8.25: return 41, 11
        if font_size > 7.75: return 44, 11
        if font_size > 6.5:  return 47, 12
        return 53, 12

    if font_size > 11.5: return 19, 7
    if font_size > 10.5: return 21, 8
    if font_size > 9.5:  return 23, 8
    if font_size > 8.5:  return 25, 9
    if font_size > 8.25: return 28, 9
    if font_size > 7.75: return 30, 9
    if font_size > 6.5:  return 31, 9
    return 34, 9


def json_request(base_url: str, path: str, method: str = "GET", data: Any | None = None, auth_token: str | None = None) -> Any:
    url = build_firebase_url(base_url, path, auth_token=auth_token)
    body = None
    headers = {}
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=20) as resp:
        raw = resp.read().decode("utf-8")
        if not raw:
            return None
        return json.loads(raw)


def firebase_anonymous_sign_in(api_key: str) -> dict[str, Any]:
    url = f"https://identitytoolkit.googleapis.com/v1/accounts:signUp?key={urllib.parse.quote(api_key)}"
    body = json.dumps({"returnSecureToken": True}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def build_firebase_url(base_url: str, path: str, auth_token: str | None = None) -> str:
    clean_path = path.strip("/")
    if clean_path:
        url = base_url.rstrip("/") + "/" + clean_path + ".json"
    else:
        url = base_url.rstrip("/") + "/.json"
    if auth_token:
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}auth={urllib.parse.quote(auth_token)}"
    return url


def deep_copy_json(value: Any) -> Any:
    return json.loads(json.dumps(value))


def apply_stream_update(document: Any, path: str, data: Any, event_type: str) -> Any:
    clean = [segment for segment in str(path or "/").split("/") if segment]
    if not clean:
        if event_type == "patch" and isinstance(document, dict) and isinstance(data, dict):
            base = deep_copy_json(document)
            base.update(data)
            return base
        return deep_copy_json(data)

    root = deep_copy_json(document)
    if root is None or not isinstance(root, (dict, list)):
        root = {}

    cursor = root
    for segment in clean[:-1]:
        if isinstance(cursor, dict):
            child = cursor.get(segment)
            if not isinstance(child, (dict, list)):
                child = {}
                cursor[segment] = child
            cursor = child
        else:
            raise RuntimeError(f"No se puede aplicar update sobre path {path}")

    leaf = clean[-1]
    if isinstance(cursor, dict):
        if event_type == "patch" and isinstance(data, dict):
            current = cursor.get(leaf)
            if not isinstance(current, dict):
                current = {}
            current = deep_copy_json(current)
            current.update(data)
            cursor[leaf] = current
        elif data is None:
            cursor.pop(leaf, None)
        else:
            cursor[leaf] = deep_copy_json(data)
    else:
        raise RuntimeError(f"No se puede aplicar update sobre path {path}")

    return root


@dataclass
class RoleConfig:
    name: str
    enabled: bool
    printer_name: str
    paper: str
    font_size: float
    uppercase: bool


class PrinterService:
    def __init__(self, config: dict[str, Any]) -> None:
        self.config = config
        self.base_url = config["firebase"]["database_url"].rstrip("/")
        self.api_key = str(config["firebase"].get("api_key") or "")
        self.service_id = str(config["service"].get("id") or "local-print-service-1")
        self.service_key = safe_service_key(self.service_id)
        self.poll_seconds = max(1, int(config["service"].get("poll_interval_seconds", 2)))
        self.reconnect_seconds = max(1, int(config["service"].get("reconnect_delay_seconds", self.poll_seconds)))
        self.print_script = str((BUNDLE_DIR / config["service"].get("print_script", "print-receipt.ps1")).resolve())
        self.log_file = str((EXE_DIR / config["service"].get("log_file", "printer-service.log")).resolve())
        self.id_token = ""
        self.token_expires_at = 0.0
        self.root_state: dict[str, Any] = {}
        self.recent_role_marks: dict[str, float] = {}
        self.recent_job_marks: dict[str, float] = {}
        self.customer_ticket_cfg = RoleConfig(
            name="ticket_final", enabled=True, printer_name="", paper="58mm", font_size=9, uppercase=False
        )
        self._paused_prev: bool = False

    def _build_role(self, name: str, ps_cfg: dict[str, Any], local_config: dict[str, Any]) -> RoleConfig:
        role_data = ps_cfg.get(name) or {}
        paper = str(role_data.get("paper") or "58mm")
        if name == "barra":
            font_size = float(local_config.get("barraFontSize") or role_data.get("fontSize") or 9)
            uppercase = bool(local_config.get("barraUppercase") or role_data.get("uppercase", False))
        elif name == "cocina":
            font_size = float(local_config.get("cocinaFontSize") or role_data.get("fontSize") or 9)
            uppercase = bool(local_config.get("cocinaUppercase") or role_data.get("uppercase", False))
        else:
            font_size = float(role_data.get("fontSize") or 9)
            uppercase = bool(role_data.get("uppercase", False))
        return RoleConfig(
            name=name,
            enabled=bool(role_data.get("enabled", True)),
            printer_name=str(role_data.get("printerName") or ""),
            paper=paper,
            font_size=font_size,
            uppercase=uppercase,
        )

    def ensure_auth(self, force: bool = False) -> None:
        if not self.api_key:
            raise RuntimeError("Falta firebase.api_key en printer-service-config.json")
        if not force and self.id_token and time.time() < self.token_expires_at:
            return
        auth = firebase_anonymous_sign_in(self.api_key)
        self.id_token = str(auth.get("idToken") or "")
        expires_in = int(auth.get("expiresIn") or 3600)
        self.token_expires_at = time.time() + max(60, expires_in - 120)
        if not self.id_token:
            raise RuntimeError("No se pudo obtener idToken de Firebase")
        log("Autenticado en Firebase")

    def fetch_state(self) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
        self.ensure_auth()
        pedidos = json_request(self.base_url, "pedidos", "GET", auth_token=self.id_token) or {}
        mesas = json_request(self.base_url, "mesas", "GET", auth_token=self.id_token) or {}
        local = json_request(self.base_url, "config/local", "GET", auth_token=self.id_token) or {}
        return pedidos, mesas, local

    def fetch_root_state(self) -> dict[str, Any]:
        self.ensure_auth()
        root = json_request(self.base_url, "", "GET", auth_token=self.id_token) or {}
        return root if isinstance(root, dict) else {}

    def fetch_print_jobs(self) -> dict[str, Any]:
        self.ensure_auth()
        return json_request(self.base_url, "print_jobs", "GET", auth_token=self.id_token) or {}

    def get_cached_state(self) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]:
        pedidos = self.root_state.get("pedidos") or {}
        mesas = self.root_state.get("mesas") or {}
        local = ((self.root_state.get("config") or {}).get("local")) or {}
        print_jobs = self.root_state.get("print_jobs") or {}
        return pedidos, mesas, local, print_jobs

    def format_receipt_text(self, role: str, mesa_nombre: str, envio: dict[str, Any], lineas: list[dict[str, Any]]) -> str:
        now = datetime.now()
        meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
        fecha = f"{now.day} {meses[now.month - 1]} {now.strftime('%H:%M')}"
        camarero = str(envio.get("camarero") or "").strip()
        title = f"{role.upper()} - Mesa {mesa_nombre}"
        lines = [f"[[LEFT_META]]{title}"]
        if camarero:
            lines.append(f"[[LEFT_SUBTITLE]]Camarero: {camarero}")
        lines.append(f"[[LEFT_SUBTITLE]]{fecha}")
        lines.append("--------------------------------")

        for item in lineas:
            qty = int(item.get("qty") or 0)
            name = str(item.get("nombre") or "").strip()
            if qty <= 0 or not name:
                continue
            name_lines = wrap_text(name, 28)
            lines.append(f"{qty}x {name_lines[0]}")
            for extra in name_lines[1:]:
                lines.append(f"   {extra}")
            nota = str(item.get("nota") or "").strip()
            if nota:
                for note_line in wrap_text("-> " + nota, 28):
                    lines.append(f"   {note_line}")

        lines.append("--------------------------------")
        return "\n".join(lines) + "\n"

    def print_text(self, text: str, role_cfg: RoleConfig, logo_path: str | None = None, header_offset: int = 0, qr_path: str | None = None) -> None:
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8", newline="\n") as tmp:
            tmp.write(text)
            temp_path = tmp.name

        try:
            args = [
                "powershell",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                self.print_script,
                "-FilePath",
                temp_path,
                "-Paper",
                role_cfg.paper,
                "-FontSize",
                str(role_cfg.font_size),
                "-LogPath",
                self.log_file,
            ]
            if role_cfg.printer_name:
                args.extend(["-PrinterName", role_cfg.printer_name])
            if logo_path and os.path.exists(logo_path):
                args.extend(["-LogoPath", logo_path])
            if header_offset:
                args.extend(["-HeaderOffset", str(header_offset)])
            if role_cfg.uppercase:
                args.append("-Uppercase")
            if qr_path and os.path.exists(qr_path):
                args.extend(["-QrPath", qr_path])

            proc = subprocess.run(args, capture_output=True, text=True, check=False)
            if proc.returncode != 0:
                detail = proc.stderr.strip() or proc.stdout.strip() or "Error desconocido"
                raise RuntimeError(detail)
        finally:
            try:
                os.remove(temp_path)
            except OSError:
                pass
            if logo_path:
                try:
                    os.remove(logo_path)
                except OSError:
                    pass
            if qr_path:
                try:
                    os.remove(qr_path)
                except OSError:
                    pass

    def mark_printed(self, mesa_id: str, envio_id: str, role: str, payload: dict[str, Any]) -> None:
        path = f"pedidos/{mesa_id}/{envio_id}/_printService/{role}/{self.service_key}"
        self.ensure_auth()
        json_request(self.base_url, path, "PUT", payload, auth_token=self.id_token)

    def patch_print_job(self, job_id: str, payload: dict[str, Any]) -> None:
        self.ensure_auth()
        json_request(self.base_url, f"print_jobs/{job_id}", "PATCH", payload, auth_token=self.id_token)

    def role_print_key(self, mesa_id: str, envio_id: str, role: str) -> str:
        return f"{mesa_id}|{envio_id}|{role}"

    def cleanup_recent_marks(self) -> None:
        cutoff = time.time() - 300
        self.recent_role_marks = {k: ts for k, ts in self.recent_role_marks.items() if ts >= cutoff}
        self.recent_job_marks = {k: ts for k, ts in self.recent_job_marks.items() if ts >= cutoff}

    def process_current_state(self) -> None:
        ps_cfg = (self.root_state.get("config") or {}).get("printService") or {}
        currently_paused = bool(ps_cfg.get("paused", False))

        if currently_paused:
            self._paused_prev = True
            return

        if self._paused_prev:
            # Acaba de reanudarse: recarga estado limpio desde Firebase para que los
            # "marcados como impresos" mientras estaba pausado sean visibles.
            self._paused_prev = False
            log("Reanudando — recargando estado desde Firebase")
            self.root_state = self.fetch_root_state()
            ps_cfg = (self.root_state.get("config") or {}).get("printService") or {}
            if bool(ps_cfg.get("paused", False)):
                return
        pedidos, mesas, local_config, print_jobs = self.get_cached_state()
        for role_name in ("barra", "cocina"):
            role = self._build_role(role_name, ps_cfg, local_config)
            self.process_role(role, pedidos, mesas, local_config)
        customer_cfg = self._build_role("ticketFinal", ps_cfg, local_config)
        customer_cfg = RoleConfig(
            name="ticket_final",
            enabled=customer_cfg.enabled,
            printer_name=customer_cfg.printer_name,
            paper=customer_cfg.paper,
            font_size=customer_cfg.font_size,
            uppercase=customer_cfg.uppercase,
        )
        self.customer_ticket_cfg = customer_cfg
        self.process_print_jobs(print_jobs)

    def iter_stream_events(self):
        self.ensure_auth()
        url = build_firebase_url(self.base_url, "", auth_token=self.id_token)
        req = urllib.request.Request(
            url,
            headers={
                "Accept": "text/event-stream",
                "Cache-Control": "no-cache",
            },
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=90) as resp:
            event_type = ""
            data_lines: list[str] = []
            for raw_line in resp:
                line = raw_line.decode("utf-8").rstrip("\r\n")
                if not line:
                    if data_lines:
                        payload_text = "\n".join(data_lines)
                        try:
                            payload = json.loads(payload_text)
                        except json.JSONDecodeError:
                            payload = None
                        yield event_type or "put", payload
                    event_type = ""
                    data_lines = []
                    continue
                if line.startswith(":"):
                    continue
                if line.startswith("event:"):
                    event_type = line.split(":", 1)[1].strip()
                    continue
                if line.startswith("data:"):
                    data_lines.append(line.split(":", 1)[1].lstrip())

    def consume_stream_forever(self) -> None:
        while True:
            try:
                for event_type, payload in self.iter_stream_events():
                    if event_type == "keep-alive":
                        continue
                    if not isinstance(payload, dict):
                        continue
                    path = str(payload.get("path") or "/")
                    data = payload.get("data")
                    if event_type not in ("put", "patch"):
                        continue
                    self.root_state = apply_stream_update(self.root_state, path, data, event_type)
                    self.process_current_state()
                raise RuntimeError("Conexion de streaming cerrada")
            except urllib.error.HTTPError as exc:
                if exc.code == 401:
                    log("Stream sin autorizacion, renovando sesion")
                    self.ensure_auth(force=True)
                else:
                    log(f"Error HTTP en stream: {exc}")
            except urllib.error.URLError as exc:
                log(f"Error de red en stream: {exc}")
            except Exception as exc:
                log(f"Reconectando stream: {exc}")

            time.sleep(self.reconnect_seconds)

    def already_printed(self, envio: dict[str, Any], role: str, mesa_id: str | None = None, envio_id: str | None = None) -> bool:
        if mesa_id and envio_id:
            if self.role_print_key(mesa_id, envio_id, role) in self.recent_role_marks:
                return True
        marks = (((envio.get("_printService") or {}).get(role) or {}).get(self.service_key)) or None
        return bool(marks)

    def pending_lines_for_role(self, envio: dict[str, Any], role: str) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        lineas = envio.get("lineas") or {}
        for art_id, linea in lineas.items():
            destino = str(linea.get("destino") or "")
            estado = str(linea.get("estado") or "")
            if estado != "pendiente":
                continue
            if destino not in (role, "ambos"):
                continue
            linea_copy = dict(linea)
            linea_copy["_artId"] = art_id
            out.append(linea_copy)
        return out

    def process_role(self, role_cfg: RoleConfig, pedidos: dict[str, Any], mesas: dict[str, Any], local_config: dict[str, Any]) -> None:
        if not role_cfg.enabled:
            return
        self.cleanup_recent_marks()

        role_service_id = ""
        if role_cfg.name == "barra":
            role_service_id = str(local_config.get("barraPrintServiceId") or "").strip()
        elif role_cfg.name == "cocina":
            role_service_id = str(local_config.get("cocinaPrintServiceId") or "").strip()
        if role_service_id and role_service_id != self.service_id:
            return

        role_font_size = role_cfg.font_size
        if role_cfg.name == "barra":
            role_font_size = float(local_config.get("barraFontSize") or role_cfg.font_size)
        elif role_cfg.name == "cocina":
            role_font_size = float(local_config.get("cocinaFontSize") or role_cfg.font_size)

        effective_cfg = RoleConfig(
            name=role_cfg.name,
            enabled=role_cfg.enabled,
            printer_name=role_cfg.printer_name,
            paper=role_cfg.paper,
            font_size=role_font_size,
            uppercase=(
                bool(local_config.get("barraUppercase"))
                if role_cfg.name == "barra"
                else bool(local_config.get("cocinaUppercase"))
                if role_cfg.name == "cocina"
                else role_cfg.uppercase
            ),
        )

        candidatos: list[tuple[int, str, str, str, dict[str, Any], list[dict[str, Any]]]] = []
        for mesa_id, envios in pedidos.items():
            mesa_nombre = str((mesas.get(mesa_id) or {}).get("nombre") or mesa_id)
            for envio_id, envio in (envios or {}).items():
                if self.already_printed(envio, role_cfg.name, mesa_id, envio_id):
                    continue
                lineas = self.pending_lines_for_role(envio, role_cfg.name)
                if not lineas:
                    continue
                ts = int(envio.get("ts") or 0)
                candidatos.append((ts, mesa_id, mesa_nombre, envio_id, envio, lineas))

        candidatos.sort(key=lambda x: (x[0], x[2], x[3]))

        for ts, mesa_id, mesa_nombre, envio_id, envio, lineas in candidatos:
            dedupe_key = self.role_print_key(mesa_id, envio_id, effective_cfg.name)
            if dedupe_key in self.recent_role_marks:
                continue
            self.recent_role_marks[dedupe_key] = time.time()
            text = self.format_receipt_text(effective_cfg.name, mesa_nombre, envio, lineas)
            log(f"Imprimiendo {effective_cfg.name} mesa {mesa_nombre} envio {envio_id}")
            self.print_text(text, effective_cfg)
            self.mark_printed(
                mesa_id,
                envio_id,
                effective_cfg.name,
                {
                    "printedAt": int(time.time() * 1000),
                    "serviceId": self.service_id,
                    "paper": effective_cfg.paper,
                    "lineCount": len(lineas),
                    "fontSize": effective_cfg.font_size,
                },
            )
            log(f"Impreso {effective_cfg.name} mesa {mesa_nombre} envio {envio_id}")
            if local_config.get("comandaAutoServir"):
                for linea in lineas:
                    art_id = linea.get("_artId")
                    if art_id:
                        try:
                            json_request(self.base_url, f"pedidos/{mesa_id}/{envio_id}/lineas/{art_id}/estado", "PUT", "servido", auth_token=self.id_token)
                        except Exception as exc:
                            log(f"Error auto-servir artId {art_id}: {exc}")
                log(f"Auto-servidas {len(lineas)} líneas mesa {mesa_nombre}")

    def format_customer_ticket_text(self, job: dict[str, Any]) -> tuple[str, RoleConfig, str | None, int, str | None]:
        format_cfg = job.get("format") or {}
        local = job.get("local") or {}
        show_notes = bool(local.get("ticketShowNotes", True))
        # El ancho fisico debe seguir la configuracion actual del servicio/impresora.
        # Si llega un payload antiguo con otro papel, no debe forzar un ancho incorrecto.
        paper = str(self.customer_ticket_cfg.paper or format_cfg.get("paper") or "58mm")
        font_size = float(format_cfg.get("fontSize") or self.customer_ticket_cfg.font_size or 9)
        uppercase = bool(format_cfg.get("uppercase", self.customer_ticket_cfg.uppercase))
        header_offset = int(format_cfg.get("headerOffset") or 0)
        printer_cfg = RoleConfig(
            name="ticket_final",
            enabled=self.customer_ticket_cfg.enabled,
            printer_name=self.customer_ticket_cfg.printer_name,
            paper=paper,
            font_size=font_size,
            uppercase=uppercase,
        )

        max_chars, price_width = receipt_layout(paper, font_size)
        # Fixed column widths for item lines (independent of font/paper so they're predictable):
        #   qty_col  : 2 chars  (up to "99")
        #   pc / tc  : 7 chars each  ("999,99€" = 7 chars incl. euro symbol)
        #   name_col : rest of available width
        qty_col  = 2
        pc       = 7   # unit-price column width
        tc       = 7   # total-price column width
        name_col = max(5, max_chars - qty_col - 1 - pc - 1 - tc)
        created_at = int(job.get("createdAt") or 0)
        created_text = datetime.fromtimestamp(created_at / 1000).strftime("%d/%m/%Y  %H:%M") if created_at else datetime.now().strftime("%d/%m/%Y  %H:%M")

        logo_url = str(local.get("logoUrl") or "").strip()
        logo_path = _download_logo(logo_url) if logo_url else None
        if logo_url and not logo_path:
            log("Advertencia: logo configurado pero no se pudo cargar, se omite")

        lines: list[str] = []
        local_name = str(local.get("nombre") or "").strip()
        if local_name:
            title_chars = max(8, int(max_chars * font_size / (font_size + 3)))
            for title_line in wrap_text(local_name, title_chars):
                lines.append(f"[[TITLE]]{title_line}")
        for key in ("direccion", "telefono", "cif"):
            value = str(local.get(key) or "").strip()
            if value:
                lines.append(f"[[SUBTITLE]]{value}")

        mesa_nombre = str(job.get("mesaNombre") or "").strip()
        if mesa_nombre:
            lines.append("")
            lines.append(f"[[CENTER_META]]Mesa {mesa_nombre}")
        lines.append(f"[[SUBTITLE]]{created_text}")
        lines.append("[[RULE]]")

        # Header row aligned with item columns
        hdr = (
            "Ud".ljust(qty_col) + " " +
            "Articulo".ljust(name_col) +
            "Precio".rjust(pc) + " " +
            "Total".rjust(tc)
        )
        lines.append(f"[[RAW]]{hdr}")
        lines.append("[[RULE]]")

        indent = " " * (qty_col + 1)  # continuation-line indent (under name column)

        for item in job.get("lines") or []:
            qty = int(item.get("qty") or 0)
            name = str(item.get("nombre") or "").strip()
            if qty <= 0 or not name:
                continue
            unit_price = float(item.get("precio") or 0)
            total_line = unit_price * qty
            unit_text = f"{unit_price:.2f}{EURO_SYMBOL}".replace(".", ",")
            total_text = f"{total_line:.2f}{EURO_SYMBOL}".replace(".", ",")
            wrapped_name = wrap_text(name, name_col)
            # First line: qty | name | unit_price | total_price
            line_str = (
                str(qty)[:qty_col].ljust(qty_col) + " " +
                wrapped_name[0].ljust(name_col) +
                unit_text.rjust(pc) + " " +
                total_text.rjust(tc)
            )
            lines.append(f"[[RAW]]{line_str}")
            # Continuation lines: indent to name column, no price columns
            for extra in wrapped_name[1:]:
                lines.append(f"[[RAW]]{indent}{extra}")
            note = str(item.get("nota") or "").strip()
            if show_notes and note:
                note_prefix = "| -> "
                note_wrap = wrap_text(note, max_chars - len(indent) - len(note_prefix))
                if note_wrap:
                    lines.append(f"[[ITALIC]]{indent}{note_prefix}{note_wrap[0]}")
                    for extra_note in note_wrap[1:]:
                        lines.append(f"[[ITALIC]]{indent}|    {extra_note}")

        lines.append("")
        lines.append("[[RULE]]")
        total_amount = float(job.get("total") or 0)
        total_text = f"{total_amount:.2f}{EURO_SYMBOL}".replace(".", ",")
        lines.append(f"[[TOTAL]]{'TOTAL'.ljust(max_chars - price_width)}{total_text.rjust(price_width)}")
        cobro = job.get("cobro")
        if cobro:
            recibido = float(cobro.get("recibido") or 0)
            cambio = float(cobro.get("cambio") or 0)
            rec_text = f"{recibido:.2f}{EURO_SYMBOL}".replace(".", ",")
            cam_text = f"{cambio:.2f}{EURO_SYMBOL}".replace(".", ",")
            lines.append(f"[[RAW]]{'Recibido'.ljust(max_chars - price_width)}{rec_text.rjust(price_width)}")
            lines.append(f"[[TOTAL]]{'Cambio'.ljust(max_chars - price_width)}{cam_text.rjust(price_width)}")
        lines.append("")
        lines.append("")
        lines.append("")

        footer = str(local.get("footer") or "").strip()
        if footer:
            dash_dot_line = ("-." * ((max_chars + 1) // 2))[:max_chars]
            lines.append(dash_dot_line)
            for footer_line in wrap_text(footer, max_chars):
                lines.append(f"[[FOOTER]]{footer_line}")
            lines.append(dash_dot_line)

        # ── Sección Verifactu ─────────────────────────────────────────────────
        qr_path = None
        vf = job.get("verifactu")
        if vf and isinstance(vf, dict):
            lines.append("[[RULE]]")
            tipo = str(vf.get("tipo") or "")
            serie = str(vf.get("serie") or "")
            numero = str(vf.get("numero") or "")
            fecha = str(vf.get("fecha") or "")
            uuid = str(vf.get("uuid") or "")

            tipo_label = {
                "F1": "Factura Completa",
                "F2": "Ticket Simplificado",
                "F3": "Factura Sustitutiva",
                "R1": "Rectificativa (Art.80.1,2,6)",
                "R5": "Rectificativa Simplificada",
            }.get(tipo, tipo or "Verifactu")

            lines.append(f"[[SUBTITLE]]{tipo_label}")
            if serie and numero:
                lines.append(f"[[RAW]]{('Nº ' + serie + '-' + numero).ljust(max_chars)}")
            if fecha:
                lines.append(f"[[RAW]]{'Fecha:'.ljust(max_chars - len(fecha))}{fecha}")

            dest = vf.get("destinatario")
            if dest and isinstance(dest, dict):
                nif = str(dest.get("nif") or "").strip()
                nombre = str(dest.get("nombre") or "").strip()
                if nif:
                    lines.append(f"[[RAW]]{'NIF:'.ljust(max_chars - len(nif))}{nif}")
                if nombre:
                    for ln in wrap_text(nombre, max_chars):
                        lines.append(f"[[RAW]]{ln}")
                direccion = str(dest.get("direccion") or "").strip()
                if direccion:
                    for ln in wrap_text(direccion, max_chars):
                        lines.append(f"[[RAW]]{ln}")

            lineas_iva = vf.get("lineasIva") or []
            if lineas_iva:
                lines.append("")
                lines.append(f"[[RAW]]{'Base imp.'.ljust(max_chars - 14)}{'IVA%'.rjust(6)}{'Cuota'.rjust(8)}")
                lines.append("[[RULE]]")
                for lv in lineas_iva:
                    base = str(lv.get("base_imponible") or "0.00")
                    iva = str(lv.get("tipo_impositivo") or "")
                    cuota = str(lv.get("cuota_repercutida") or "0.00")
                    base_e = base + "€"
                    cuota_e = cuota + "€"
                    iva_pct = iva + "%"
                    row = base_e.ljust(max_chars - len(iva_pct) - len(cuota_e) - 2) + iva_pct.rjust(len(iva_pct)) + " " + cuota_e.rjust(len(cuota_e))
                    lines.append(f"[[RAW]]{row}")

            if uuid:
                short_uuid = uuid[:36]
                lines.append("")
                for ln in wrap_text(short_uuid, max_chars):
                    lines.append(f"[[RAW]]{ln}")

            lines.append("")
            lines.append(f"[[FOOTER]]Conforme RD 1007/2023 - Verifactu")

            # Decode QR base64 to temp file
            qr_b64 = str(vf.get("qr") or "").strip()
            if qr_b64:
                try:
                    qr_data = base64.b64decode(qr_b64)
                    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as qtmp:
                        qtmp.write(qr_data)
                        qr_path = qtmp.name
                except Exception as exc:
                    log(f"Advertencia: no se pudo decodificar QR Verifactu: {exc}")
                    qr_path = None

        return "\n".join(lines) + "\n", printer_cfg, logo_path, header_offset, qr_path

    def process_print_jobs(self, print_jobs: dict[str, Any]) -> None:
        self.cleanup_recent_marks()

        candidates: list[tuple[int, str, dict[str, Any]]] = []
        for job_id, job in (print_jobs or {}).items():
            job_kind = str(job.get("kind") or "")
            if job_kind not in ("ticket_final", "comanda"):
                continue
            if str(job.get("status") or "pending") != "pending":
                continue
            if str(job.get("serviceId") or self.service_id) != self.service_id:
                continue
            if job_id in self.recent_job_marks:
                continue
            created_at = int(job.get("createdAt") or 0)
            candidates.append((created_at, job_id, job))

        candidates.sort(key=lambda item: (item[0], item[1]))

        for _, job_id, job in candidates:
            job_kind = str(job.get("kind") or "")
            mesa_nombre = str(job.get("mesaNombre") or "").strip() or "sin-mesa"
            log(f"Procesando job '{job_kind}' mesa {mesa_nombre} job {job_id}")
            try:
                self.recent_job_marks[job_id] = time.time()

                if job_kind == "ticket_final":
                    if not self.customer_ticket_cfg.enabled:
                        log(f"Ticket final ignorado (servicio ticket deshabilitado): {job_id}")
                        continue
                    text, printer_cfg, logo_path, header_offset, qr_path = self.format_customer_ticket_text(job)
                    self.print_text(text, printer_cfg, logo_path=logo_path, header_offset=header_offset, qr_path=qr_path)

                elif job_kind == "comanda":
                    ps_cfg = (self.root_state.get("config") or {}).get("printService") or {}
                    local_config = ((self.root_state.get("config") or {}).get("local")) or {}
                    role_name = str(job.get("rol") or "barra")
                    role_cfg = self._build_role(role_name, ps_cfg, local_config)
                    if not role_cfg.enabled:
                        log(f"Comanda ignorada (rol '{role_name}' deshabilitado): {job_id}")
                        continue
                    envio = {"camarero": job.get("camarero") or ""}
                    lineas = list(job.get("lineas") or [])
                    text = self.format_receipt_text(role_cfg.name, mesa_nombre, envio, lineas)
                    if role_cfg.uppercase:
                        text = text.upper()
                    self.print_text(text, role_cfg)

                self.patch_print_job(
                    job_id,
                    {
                        "status": "printed",
                        "printedAt": int(time.time() * 1000),
                        "printedByService": self.service_id,
                    },
                )
                log(f"Impreso job '{job_kind}' mesa {mesa_nombre} job {job_id}")
            except Exception as exc:
                self.patch_print_job(
                    job_id,
                    {
                        "status": "error",
                        "lastError": str(exc),
                        "lastErrorAt": int(time.time() * 1000),
                    },
                )
                raise

    def run(self) -> None:
        log("Servicio de impresion iniciado")
        log(f"Firebase: {self.base_url}")
        log("Configuracion de impresoras: se carga desde el panel de admin (config/printService)")
        self.root_state = self.fetch_root_state()
        ps_cfg = (self.root_state.get("config") or {}).get("printService") or {}
        if ps_cfg.get("paused", False):
            log("Servicio en pausa (panel admin). Reanuda desde admin.html")
        self.process_current_state()
        log("Escucha en tiempo real activada")
        self.consume_stream_forever()


def load_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        raise FileNotFoundError(f"No existe el archivo de configuracion: {CONFIG_PATH}")
    cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    fb = cfg.get("firebase", {})
    if "database_url_enc" in fb and not fb.get("database_url"):
        fb["database_url"] = _decode_field(fb["database_url_enc"])
    if "api_key_enc" in fb and not fb.get("api_key"):
        fb["api_key"] = _decode_field(fb["api_key_enc"])
    cfg["firebase"] = fb
    return cfg


def main() -> int:
    try:
        config = load_config()
        service = PrinterService(config)
        service.run()
        return 0
    except KeyboardInterrupt:
        log("Servicio detenido por el usuario")
        return 0
    except Exception as exc:
        log(f"Error fatal: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
