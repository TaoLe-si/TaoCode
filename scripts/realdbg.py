"""真机取证驱动：连进 TaoCode 的 WebView2（TAOCODE_DEBUG_PORT），按步骤发**真**鼠标/键盘事件并读 DOM。

为什么需要它：合成事件（`element.click()`、`dispatchEvent(new MouseEvent(...))`）在真机里推不动
Vue 的事件链 —— 实测点左侧条、点运行面板都毫无反应；只有 CDP 的 Input.dispatch* 才是"用户输入"。
（同类记录：合成 click 不是用户手势，验复制要真鼠标点击。）

用法：
  python scripts/realdbg.py <port> steps.json [--shot out.png]

steps.json 是一个数组，每步是下面之一（按顺序执行，每步之间默认等 400ms）：
  {"eval": "<js>"}            → 在前端求值，结果进结果表（键用 "as" 指定）
  {"click": [x, y]}           → 真左键单击
  {"dblclick": [x, y]}        → 真左键双击
  {"clickText": "运行"}        → 找到文本/标题/aria-label 精确等于它的按钮，取中心点真点击
  {"key": "ctrl+shift+a"}     → 真组合键
  {"text": "编辑配置"}         → 真文本输入（Input.insertText，走 input 事件）
  {"wait": 800}               → 等毫秒
  {"shot": "build/shot.png"}  → 截图
"""
import base64, json, sys, time, urllib.request
from websockets.sync.client import connect

MODIFIERS = {'alt': 1, 'ctrl': 2, 'meta': 4, 'shift': 8}
KEYS = {'enter': ('Enter', 13), 'esc': ('Escape', 27), 'tab': ('Tab', 9), 'down': ('ArrowDown', 40),
        'up': ('ArrowUp', 38), 'left': ('ArrowLeft', 37), 'right': ('ArrowRight', 39), 'delete': ('Delete', 46),
        # 功能键：F1..F12 = VK 112..123（Shift+F10 = 运行当前配置，是本批取证要用的）
        **{f'f{n}': (f'F{n}', 111 + n) for n in range(1, 13)}}


def main():
    port = sys.argv[1]
    steps = json.load(open(sys.argv[2], encoding='utf-8'))
    shot_path = sys.argv[sys.argv.index('--shot') + 1] if '--shot' in sys.argv else None
    targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list"))
    page = [entry for entry in targets if entry.get('type') == 'page'][0]
    results = {}
    with connect(page['webSocketDebuggerUrl'], max_size=64 * 1024 * 1024) as ws:
        counter = [0]

        def call(method, params=None):
            counter[0] += 1
            ws.send(json.dumps({'id': counter[0], 'method': method, 'params': params or {}}))
            while True:
                message = json.loads(ws.recv())
                if message.get('id') == counter[0]:
                    return message

        def evaluate(expression):
            reply = call('Runtime.evaluate', {'expression': expression, 'awaitPromise': True, 'returnByValue': True})
            return reply.get('result', {}).get('result', {}).get('value')

        def center(text):
            expression = ("(() => { const want = %s; const all = [...document.querySelectorAll('button,[role=option],[role=menuitem]')];"
                          "const hit = all.find(el => ((el.getAttribute('title') ?? el.textContent ?? '').trim()) === want"
                          " || (el.getAttribute('aria-label') ?? '') === want);"
                          "if (!hit) return null; const r = hit.getBoundingClientRect();"
                          "return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()") % json.dumps(text)
            return evaluate(expression)

        def mouse(kind, x, y, clicks=1):
            call('Input.dispatchMouseEvent', {'type': kind, 'x': x, 'y': y, 'button': 'left', 'clickCount': clicks,
                                              'buttons': 1 if kind == 'mousePressed' else 0})

        def key(combo):
            parts = combo.lower().split('+')
            # 注意：不能写成 KEYS.get(k, (k, ord(k.upper()))) —— 默认值在 Python 里是**先求值**的，
            # 就算命中了 KEYS 也会对 'enter' 这种多字符键名执行 ord() 并抛 TypeError（踩过一次）。
            last = parts[-1]
            if last in KEYS:
                name, code = KEYS[last]
            else:
                name, code = last, (ord(last.upper()) if len(last) == 1 else 0)
            modifiers = 0
            for part in parts[:-1]:
                modifiers |= MODIFIERS[part]
            for kind in ('keyDown', 'keyUp'):
                call('Input.dispatchKeyEvent', {'type': kind, 'key': name, 'code': f'Key{name.upper()}' if len(name) == 1 else name,
                                                'windowsVirtualKeyCode': code, 'modifiers': modifiers,
                                                'text': name if (len(name) == 1 and kind == 'keyDown') else ''})

        for index, step in enumerate(steps):
            label = step.get('as', f'step{index}')
            if 'wait' in step:
                time.sleep(step['wait'] / 1000)
            elif 'eval' in step:
                results[label] = evaluate(step['eval'])
            elif 'clickText' in step:
                point = center(step['clickText'])
                if not point:
                    results[label] = f'NOT FOUND: {step["clickText"]}'
                else:
                    mouse('mousePressed', point['x'], point['y'])
                    mouse('mouseReleased', point['x'], point['y'])
                    results[label] = point
            elif 'click' in step:
                x, y = step['click']
                mouse('mousePressed', x, y)
                mouse('mouseReleased', x, y)
                results[label] = 'clicked'
            elif 'clickLabel' in step:
                # 先 scrollIntoView 再点：对话框比窗口高时控件会落在视口外（y 为负或 > innerHeight），
                # 直接按它的坐标点会打到别的东西上（2026-10-04 踩过：点「配置名称」打到了菜单栏）。
                point = evaluate("(() => { const el = document.querySelector(%s); if (!el) return null; el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return {x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)}; })()" % json.dumps(step['clickLabel']))
                if not point or 'x' not in point:
                    results[label] = f'NO FIELD: {step["clickLabel"]}'
                else:
                    mouse('mousePressed', point['x'], point['y'])
                    mouse('mouseReleased', point['x'], point['y'])
                    results[label] = point
            elif 'typeInto' in step:
                selector, value = step['typeInto']
                point = evaluate("(() => { const el = document.querySelector(%s); if (!el) return null; el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return {x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)}; })()" % json.dumps(selector))
                if not point or 'x' not in point:
                    results[label] = f'NO FIELD: {selector}'
                else:
                    mouse('mousePressed', point['x'], point['y'])
                    mouse('mouseReleased', point['x'], point['y'])
                    time.sleep(0.15)
                    call('Input.insertText', {'text': value})
                    results[label] = f'{selector} <- {value}'
            elif 'hover' in step:
                x, y = step['hover']
                call('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': x, 'y': y, 'buttons': 0})
                results[label] = 'hovered'
            elif 'clickEval' in step:
                # 用一段 JS 算出坐标再真点击：菜单/选项卡/工具条按钮的位置随窗口与状态变，
                # 写死坐标既脆又难读，这一段让脚本自己找。
                point = evaluate(step['clickEval'])
                if not point or 'x' not in point:
                    results[label] = f'NO TARGET: {point}'
                else:
                    if step.get('hoverFirst'):
                        call('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': point['x'], 'y': point['y'], 'buttons': 0})
                        time.sleep(step.get('hoverWait', 0.5))
                    mouse('mousePressed', point['x'], point['y'])
                    mouse('mouseReleased', point['x'], point['y'])
                    results[label] = point
            elif 'dblclick' in step:
                x, y = step['dblclick']
                for clicks in (1, 2):
                    mouse('mousePressed', x, y, clicks)
                    mouse('mouseReleased', x, y, clicks)
                    time.sleep(0.02)
                results[label] = 'double-clicked'
            elif 'key' in step:
                key(step['key'])
                results[label] = step['key']
            elif 'text' in step:
                call('Input.insertText', {'text': step['text']})
                results[label] = step['text']
            elif 'shot' in step:
                data = call('Page.captureScreenshot', {'format': 'png'})
                open(step['shot'], 'wb').write(base64.b64decode(data['result']['data']))
                results[label] = step['shot']
            time.sleep(step.get('then', 0.45))
        if shot_path:
            data = call('Page.captureScreenshot', {'format': 'png'})
            open(shot_path, 'wb').write(base64.b64decode(data['result']['data']))
    print(json.dumps(results, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
