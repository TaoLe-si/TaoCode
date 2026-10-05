"""真鼠标点击（Input.dispatchMouseEvent）——合成 click 在真机里不触发 Vue 的事件链。"""
import json, sys, time, urllib.request
from websockets.sync.client import connect

port = sys.argv[1]
clicks = json.loads(sys.argv[2])  # [[x, y, pause_ms], ...]

targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list"))
page = [t for t in targets if t.get("type") == "page"][0]
with connect(page["webSocketDebuggerUrl"], max_size=64 * 1024 * 1024) as ws:
    n = [0]
    def call(method, params=None):
        n[0] += 1
        ws.send(json.dumps({"id": n[0], "method": method, "params": params or {}}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == n[0]:
                return msg
    for x, y, pause in clicks:
        for kind in ("mousePressed", "mouseReleased"):
            call("Input.dispatchMouseEvent", {"type": kind, "x": x, "y": y, "button": "left", "clickCount": 1, "buttons": 1 if kind == "mousePressed" else 0})
        time.sleep(pause / 1000)
    dbl = json.loads(sys.argv[3]) if len(sys.argv) > 3 else None
    if dbl:
        x, y = dbl
        for count in (1, 2):
            for kind in ("mousePressed", "mouseReleased"):
                call("Input.dispatchMouseEvent", {"type": kind, "x": x, "y": y, "button": "left", "clickCount": count, "buttons": 1 if kind == "mousePressed" else 0})
            time.sleep(0.02)
    print(json.dumps({"clicked": clicks, "double": dbl}, ensure_ascii=False))
