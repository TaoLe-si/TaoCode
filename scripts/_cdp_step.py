"""CDP 按键/输入一步：python scripts/_cdp_step.py <port> key <spec> | text <s> | js <file>"""
import json, sys, base64, urllib.request, time
from websockets.sync.client import connect

port = sys.argv[1]
mode = sys.argv[2]

targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list"))
ws_url = [t for t in targets if t.get("type") == "page"][0]["webSocketDebuggerUrl"]

KEY = {
    'ctrl+b': dict(modifiers=2, key='b', code='KeyB', windowsVirtualKeyCode=66, nativeVirtualKeyCode=66),
    'ctrl+shift+n': dict(modifiers=10, key='N', code='KeyN', windowsVirtualKeyCode=78, nativeVirtualKeyCode=78),
    'enter': dict(key='Enter', code='Enter', windowsVirtualKeyCode=13, nativeVirtualKeyCode=13),
    'esc': dict(key='Escape', code='Escape', windowsVirtualKeyCode=27, nativeVirtualKeyCode=27),
    'down': dict(key='ArrowDown', code='ArrowDown', windowsVirtualKeyCode=40, nativeVirtualKeyCode=40),
    'ctrl+alt+b': dict(modifiers=3, key='b', code='KeyB', windowsVirtualKeyCode=66, nativeVirtualKeyCode=66),
    'ctrl+alt+s': dict(modifiers=3, key='s', code='KeyS', windowsVirtualKeyCode=83, nativeVirtualKeyCode=83),
    'ctrl+a': dict(modifiers=2, key='a', code='KeyA', windowsVirtualKeyCode=65, nativeVirtualKeyCode=65),
    'ctrl+shift+b': dict(modifiers=10, key='B', code='KeyB', windowsVirtualKeyCode=66, nativeVirtualKeyCode=66),
    'ctrl+shift+i': dict(modifiers=10, key='I', code='KeyI', windowsVirtualKeyCode=73, nativeVirtualKeyCode=73),
    'ctrl+shift+alt+n': dict(modifiers=11, key='N', code='KeyN', windowsVirtualKeyCode=78, nativeVirtualKeyCode=78),
    'ctrl+f': dict(modifiers=2, key='f', code='KeyF', windowsVirtualKeyCode=70, nativeVirtualKeyCode=70),
    'ctrl+r': dict(modifiers=2, key='r', code='KeyR', windowsVirtualKeyCode=82, nativeVirtualKeyCode=82),
    'ctrl+alt+e': dict(modifiers=3, key='e', code='KeyE', windowsVirtualKeyCode=69, nativeVirtualKeyCode=69),
    'f3': dict(key='F3', code='F3', windowsVirtualKeyCode=114, nativeVirtualKeyCode=114),
    'shift+f3': dict(modifiers=8, key='F3', code='F3', windowsVirtualKeyCode=114, nativeVirtualKeyCode=114),
    'ctrl+f3': dict(modifiers=2, key='F3', code='F3', windowsVirtualKeyCode=114, nativeVirtualKeyCode=114),
}

with connect(ws_url, max_size=64 * 1024 * 1024) as ws:
    n = [0]
    def call(method, params=None):
        n[0] += 1
        ws.send(json.dumps({"id": n[0], "method": method, "params": params or {}}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == n[0]:
                return msg

    if mode == 'key':
        spec = KEY[sys.argv[3]]
        base = {"type": "rawKeyDown", **spec, "text": ""}
        call("Input.dispatchKeyEvent", base)
        call("Input.dispatchKeyEvent", {"type": "keyUp", **{k: v for k, v in spec.items() if k != 'text'}})
        print("KEY " + sys.argv[3])
    elif mode == 'text':
        call("Input.insertText", {"text": sys.argv[3]})
        print("TEXT " + sys.argv[3])
    elif mode == 'js':
        source = open(sys.argv[3], encoding='utf-8').read()
        r = call("Runtime.evaluate", {"expression": source, "awaitPromise": True, "returnByValue": True})
        print(json.dumps(r.get("result", {}).get("result", {}).get("value", r), ensure_ascii=False))
    elif mode == 'shot':
        data = call("Page.captureScreenshot", {"format": "png"})
        open(sys.argv[3], "wb").write(base64.b64decode(data["result"]["data"]))
        print("SHOT " + sys.argv[3])
    elif mode == 'dblclick':
        sel = sys.argv[3]
        rect = call("Runtime.evaluate", {"expression": f"(() => {{ const e = [...document.querySelectorAll({sel!r})].find(x => x.textContent.trim() === {sys.argv[4]!r}); if (!e) return null; e.scrollIntoView(); const r = e.getBoundingClientRect(); return {{x: r.left + r.width/2, y: r.top + r.height/2}}; }})()", "returnByValue": True})["result"]["result"].get("value")
        if not rect:
            print("NOT FOUND " + sys.argv[4]); raise SystemExit(1)
        for count in (1, 2):
            for kind in ("mousePressed", "mouseReleased"):
                call("Input.dispatchMouseEvent", {"type": kind, "x": rect["x"], "y": rect["y"], "button": "left", "clickCount": count})
        print("DBLCLICK " + sys.argv[4] + " at " + str(rect))
    elif mode == 'click':
        # click <selector> [index] [dx dy]
        sel = sys.argv[3]
        index = int(sys.argv[4]) if len(sys.argv) > 4 else 0
        js = f"(() => {{ const e = document.querySelectorAll({sel!r})[{index}]; if (!e) return null; const r = e.getBoundingClientRect(); return {{x: r.left + (window.__clickDx ?? 40), y: r.top + (window.__clickDy ?? 30)}}; }})()"
        rect = call("Runtime.evaluate", {"expression": js, "returnByValue": True})["result"]["result"].get("value")
        if not rect:
            print("NOT FOUND " + sel); raise SystemExit(1)
        call("Input.dispatchMouseEvent", {"type": "mousePressed", "x": rect["x"], "y": rect["y"], "button": "left", "clickCount": 1})
        call("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": rect["x"], "y": rect["y"], "button": "left", "clickCount": 1})
        print("CLICK " + sel + " at " + str(rect))
    elif mode == 'type':
        for ch in sys.argv[3]:
            call("Input.dispatchKeyEvent", {"type": "keyDown", "text": ch, "unmodifiedText": ch, "key": ch,
                                            "windowsVirtualKeyCode": ord(ch.upper()), "nativeVirtualKeyCode": ord(ch.upper())})
            call("Input.dispatchKeyEvent", {"type": "keyUp", "key": ch, "windowsVirtualKeyCode": ord(ch.upper())})
        print("TYPED " + sys.argv[3])
    elif mode == 'undo':
        for key, code, vk in (('z', 'KeyZ', 90),):
            call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "modifiers": 2, "key": key, "code": code,
                                            "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk})
            call("Input.dispatchKeyEvent", {"type": "keyUp", "key": key, "code": code, "windowsVirtualKeyCode": vk})
        print("UNDO")
    elif mode == 'rclick':
        # rclick <selector> <text>
        rect = call("Runtime.evaluate", {"expression": f"(() => {{ const e = [...document.querySelectorAll({sys.argv[3]!r})].find(x => x.textContent.trim() === {sys.argv[4]!r}); if (!e) return null; const r = e.getBoundingClientRect(); return {{x: r.left + r.width/2, y: r.top + r.height/2}}; }})()", "returnByValue": True})["result"]["result"].get("value")
        if not rect:
            print("NOT FOUND " + sys.argv[4]); raise SystemExit(1)
        call("Input.dispatchMouseEvent", {"type": "mousePressed", "x": rect["x"], "y": rect["y"], "button": "right", "clickCount": 1})
        call("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": rect["x"], "y": rect["y"], "button": "right", "clickCount": 1})
        print("RCLICK " + sys.argv[4] + " at " + str(rect))
    elif mode == 'sleep':
        time.sleep(float(sys.argv[3]))
        print("SLEPT " + sys.argv[3])
