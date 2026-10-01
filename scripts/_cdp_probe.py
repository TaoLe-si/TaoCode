"""CDP 探针：连进真 exe 的 WebView2（TAOCODE_DEBUG_PORT），跑一段 JS 并回结果/截图。

用法：python scripts/_cdp_probe.py <port> <js-file> [--shot out.png]
"""
import json, sys, base64, urllib.request
from websockets.sync.client import connect

port = sys.argv[1]
js_file = sys.argv[2]
shot = sys.argv[4] if len(sys.argv) > 4 and sys.argv[3] == '--shot' else None

targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list"))
pages = [t for t in targets if t.get("type") == "page"]
if not pages:
    print(json.dumps({"error": "no page target", "targets": targets}, ensure_ascii=False))
    raise SystemExit(1)
ws_url = pages[0]["webSocketDebuggerUrl"]
source = open(js_file, encoding="utf-8").read()

with connect(ws_url, max_size=64 * 1024 * 1024) as ws:
    n = [0]
    def call(method, params=None):
        n[0] += 1
        ws.send(json.dumps({"id": n[0], "method": method, "params": params or {}}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == n[0]:
                return msg
    result = call("Runtime.evaluate", {"expression": source, "awaitPromise": True, "returnByValue": True})
    value = result.get("result", {}).get("result", {})
    print(json.dumps(value.get("value", result), ensure_ascii=False))
    if shot:
        data = call("Page.captureScreenshot", {"format": "png"})
        open(shot, "wb").write(base64.b64decode(data["result"]["data"]))
        print("SHOT " + shot)
