"""仅监听回环地址的本地桌面应用服务。"""
import argparse
import base64
import copy
import datetime as dt
import hashlib
import json
import logging
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs

from domain import new_state, validate_state, apply_event, parse_markdown, valid_date, stats

ASSETS = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent)) / "web"
TOKEN = secrets.token_urlsafe(32)
LOCK = threading.RLock()
HISTORY = []
LAST_SEEN = time.monotonic()
STATE = None
DATA = None


def atomic_write(path, data):
    temp = path.with_suffix(path.suffix + ".tmp")
    with open(temp, "w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)
        file.flush()
        os.fsync(file.fileno())
    os.replace(temp, path)


def save_state(value):
    global STATE
    value["revision"] = STATE.get("revision", 0) + 1
    atomic_write(DATA / "schedule.json", value)
    STATE = value
    try:
        write_daily_reports()
    except OSError:
        logging.exception("日程已保存，统计缓存待下次打开时更新")


def write_daily_reports():
    """报告按日聚合；关闭应用的日期在下次启动时补齐。"""
    dates = set(e["date"] for e in STATE["events"])
    today = dt.date.today()
    start = dt.date.fromisoformat(STATE.get("createdDate", today.isoformat()))
    for n in range(max(0, (today-start).days)+1):
        dates.add((start + dt.timedelta(days=n)).isoformat())
    reports = {day: {"minutes": stats(STATE["events"],day), "complete": day < today.isoformat()}
               for day in sorted(dates)}
    atomic_write(DATA / "daily-reports.json", reports)


def media_bytes(encoded):
    try:
        raw = base64.b64decode(encoded, validate=True)
    except Exception as error:
        raise ValueError("图片编码无效") from error
    if len(raw) > 8 * 1024 * 1024:
        raise ValueError("单张图片最大 8 MB")
    ext = None
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        ext = "png"
    elif raw.startswith(b"\xff\xd8\xff"):
        ext = "jpg"
    elif raw.startswith((b"GIF87a",b"GIF89a")):
        ext = "gif"
    elif raw.startswith(b"RIFF") and raw[8:12] == b"WEBP":
        ext = "webp"
    if not ext:
        raise ValueError("支持 PNG、JPG、GIF、WebP 图片")
    return hashlib.sha256(raw).hexdigest() + "." + ext, raw


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        logging.info(fmt, *args)

    def respond(self, value, status=200):
        raw = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        global LAST_SEEN
        path = urlsplit(self.path).path
        if self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}":
            return self.respond({"error":"不允许的主机"}, 403)
        LAST_SEEN = time.monotonic()
        if path == "/api/health":
            return self.respond({"app":"timepaint", "version":1})
        if path == "/api/state":
            with LOCK:
                return self.respond({**STATE,"token":TOKEN,"canUndo":bool(HISTORY),"dataPath":str(DATA)})
        if path == "/api/export":
            with LOCK:
                result = copy.deepcopy(STATE)
                names = set(name for e in STATE["events"] for name in e["images"])
                result["media"] = {name:base64.b64encode((DATA/"media"/name).read_bytes()).decode() for name in names}
                return self.respond(result)
        if path == "/api/reports":
            with LOCK:
                write_daily_reports()
                return self.respond(json.loads((DATA/"daily-reports.json").read_text(encoding="utf-8")))
        root = DATA/"media" if path.startswith("/media/") else ASSETS
        relative = path[7:] if path.startswith("/media/") else path.lstrip("/") or "index.html"
        target = (root/relative).resolve()
        if not target.is_relative_to(root.resolve()) or not target.is_file():
            return self.respond({"error":"文件不存在"},404)
        types = {".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",
                 ".css":"text/css; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",
                 ".jpg":"image/jpeg",".webp":"image/webp",".gif":"image/gif",".ico":"image/x-icon"}
        raw = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type",types.get(target.suffix,"application/octet-stream"))
        self.send_header("Content-Length",str(len(raw)))
        self.send_header("X-Content-Type-Options","nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'")
        self.send_header("Cache-Control","no-cache")
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        try:
            if self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}" or self.headers.get("X-TimePaint-Token") != TOKEN:
                return self.respond({"error":"请从本地应用页面操作"},403)
            length = int(self.headers.get("Content-Length",0))
            if not 0 < length <= 150 * 1024 * 1024:
                raise ValueError("请求为空或超过 150 MB")
            payload = json.loads(self.rfile.read(length))
            path = urlsplit(self.path).path
            with LOCK:
                if path == "/api/upload":
                    name, raw = media_bytes(payload["data"])
                    (DATA/"media"/name).write_bytes(raw)
                    return self.respond({"name":name})
                if path == "/api/parse":
                    return self.respond({"slots":parse_markdown(payload["text"])})
                if payload.get("revision") != STATE["revision"]:
                    return self.respond({"error":"其他窗口已更新日程，请刷新后重试"},409)
                result = copy.deepcopy(STATE)
                if path == "/api/event":
                    for name in payload.get("images",[]):
                        if not isinstance(name,str) or Path(name).name != name or not (DATA/"media"/name).is_file():
                            raise ValueError("图片附件丢失，请重新上传")
                    result = apply_event(STATE,payload)
                elif path == "/api/delete":
                    result["events"] = [e for e in result["events"] if e["id"] != payload["id"]]
                elif path == "/api/template":
                    result["slots"] = parse_markdown(payload["text"])
                    result["templateName"] = str(payload.get("name","日程模板.md"))[:100]
                    if payload.get("fillWeek"):
                        first = valid_date(payload["week"])
                        for day in range(7):
                            for s in result["slots"]:
                                if s["title"]:
                                    category = "rest" if any(x in s["title"] for x in ["休息","睡","餐"]) else "study"
                                    result = apply_event(result,{**s,"date":(first+dt.timedelta(days=day)).isoformat(),"category":category})
                elif path == "/api/copy-week":
                    source, target = valid_date(payload["source"]), valid_date(payload["target"])
                    if source.weekday() or target.weekday() or source == target:
                        raise ValueError("请选择不同周的周一")
                    for event in STATE["events"]:
                        offset = (valid_date(event["date"]) - source).days
                        if 0 <= offset < 7:
                            incoming = {**event,"date":(target+dt.timedelta(days=offset)).isoformat()}
                            incoming.pop("id",None)
                            result = apply_event(result,incoming)
                elif path == "/api/restore":
                    result = validate_state(payload["backup"])
                    assets = payload["backup"].get("media",{})
                    prepared = {}
                    for event in result["events"]:
                        for name in event["images"]:
                            if name in assets:
                                actual, raw = media_bytes(assets[name])
                                if actual != name:
                                    raise ValueError("备份图片校验失败")
                                prepared[name] = raw
                            elif not (DATA/"media"/name).is_file():
                                raise ValueError("备份缺少图片附件")
                    for name,raw in prepared.items():
                        (DATA/"media"/name).write_bytes(raw)
                    atomic_write(DATA/"backups"/f"before-restore-{int(time.time())}.json",STATE)
                elif path == "/api/undo":
                    if not HISTORY:
                        raise ValueError("没有可撤销的操作")
                    result = HISTORY[-1]
                else:
                    return self.respond({"error":"不存在的操作"},404)
                result.setdefault("createdDate",STATE.get("createdDate",dt.date.today().isoformat()))
                previous = copy.deepcopy(STATE)
                save_state(result)
                if path == "/api/undo":
                    HISTORY.pop()
                else:
                    HISTORY.append(previous)
                    del HISTORY[:-30]
                self.respond({**STATE,"token":TOKEN,"canUndo":bool(HISTORY),"dataPath":str(DATA)})
        except (ValueError, KeyError, TypeError, AttributeError) as error:
            self.respond({"error":str(error)},400)
        except Exception:
            logging.exception("保存操作失败")
            self.respond({"error":"保存失败，原记录已保留。请检查磁盘空间并重试。"},500)


def open_window(port):
    url = f"http://127.0.0.1:{port}/"
    candidates = [Path(os.environ.get("PROGRAMFILES(X86)","C:/Program Files (x86)"))/"Microsoft/Edge/Application/msedge.exe",
                  Path(os.environ.get("PROGRAMFILES","C:/Program Files"))/"Microsoft/Edge/Application/msedge.exe"]
    browser = next((p for p in candidates if p.exists()),None)
    if browser:
        subprocess.Popen([str(browser),f"--app={url}",f"--user-data-dir={DATA/'window-profile'}",
                          "--window-size=1500,980","--no-first-run","--disable-background-mode"],
                         creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
    else:
        import webbrowser
        webbrowser.open(url)


def main():
    global STATE, DATA
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--stay", action="store_true")
    args = parser.parse_args()
    DATA = Path(args.data_dir) if args.data_dir else Path(os.environ.get("LOCALAPPDATA",str(Path.home())))/"TimePaint"
    DATA.mkdir(parents=True,exist_ok=True)
    (DATA/"media").mkdir(exist_ok=True)
    (DATA/"backups").mkdir(exist_ok=True)
    logging.basicConfig(filename=str(DATA/"app.log"),level=logging.INFO,encoding="utf-8")
    port_file = DATA/"port.json"
    session_lock = None
    if os.name == "nt":
        import msvcrt
        session_lock = open(DATA/"session.lock", "a+b")
        if session_lock.tell() == 0:
            session_lock.write(b"0")
            session_lock.flush()
        session_lock.seek(0)
        try:
            msvcrt.locking(session_lock.fileno(),msvcrt.LK_NBLCK,1)
        except OSError:
            for _ in range(40):
                try:
                    port = json.loads(port_file.read_text())["port"]
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health",timeout=.5) as response:
                        if json.load(response).get("app") == "timepaint":
                            if not args.no_browser:
                                open_window(port)
                            return
                except Exception:
                    time.sleep(.1)
            return
    try:
        previous = json.loads(port_file.read_text())
        with urllib.request.urlopen(f"http://127.0.0.1:{previous['port']}/api/health",timeout=1) as response:
            if json.load(response).get("app") == "timepaint":
                if not args.no_browser:
                    open_window(previous["port"])
                return
    except Exception:
        pass
    file = DATA/"schedule.json"
    if file.exists():
        try:
            stored = json.loads(file.read_text(encoding="utf-8"))
            STATE = validate_state(stored)
            STATE["createdDate"] = stored.get("createdDate",dt.date.today().isoformat())
        except Exception:
            logging.exception("日程文件无法读取，保留原件并停止")
            if os.name == "nt":
                import ctypes
                ctypes.windll.user32.MessageBoxW(0,f"日程文件无法读取，原件已保留。请检查：\n{file}\n可从 backups 文件夹恢复。","时光涂涂",16)
            return
    else:
        STATE = new_state()
        STATE["createdDate"] = dt.date.today().isoformat()
        atomic_write(file,STATE)
    today_backup = DATA/"backups"/f"{dt.date.today().isoformat()}.json"
    if not today_backup.exists():
        atomic_write(today_backup,STATE)
    write_daily_reports()
    server = ThreadingHTTPServer(("127.0.0.1",args.port),Handler)
    atomic_write(port_file,{"port":server.server_port})
    if not args.no_browser:
        threading.Timer(0.3,open_window,args=(server.server_port,)).start()
    def watchdog():
        last_day = dt.date.today()
        while True:
            time.sleep(30)
            if dt.date.today() != last_day:
                with LOCK:
                    write_daily_reports()
                last_day = dt.date.today()
            if not args.stay and time.monotonic()-LAST_SEEN > 180:
                server.shutdown()
                return
    threading.Thread(target=watchdog,daemon=True).start()
    server.serve_forever()
    server.server_close()
    if session_lock:
        session_lock.close()


if __name__ == "__main__":
    main()
