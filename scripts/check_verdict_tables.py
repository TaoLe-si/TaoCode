"""判决表**生成物**的核对引擎 —— `verdict_table.py` 的 `--dry-run` / `--check` 走这一份。

为什么要独立出来：`verdict_table.py` 过去只会「就地重写 `docs/inventory/verdict-*.md`」，
于是「复核计数」这个动作本身在改被复核的对象（2026-10-05 独立验收真踩过，
见 `docs/handoff-2026-10-05-agent-protocol.md` §4.4：验收员把 `python scripts/verdict_table.py`
当"只读复核"跑了）。这里把「比对」和「写盘」拆成两件事：

  · write    默认档，原样写盘（与加开关之前的行为逐字节一致）
  · dry-run  生成 + 与磁盘比对 + 打印，**一个字节都不写**
  · check    生成 + 比对，不一致**非零退出**并列出差异（CI 用）

比对口径是**字节**，不是「语义差不多」：生成物不许手改（判词真源在 `verdict_table.py` 的
`FAMILIES` / `PLATFORM_FAMILIES` / `MODULE_HEAP` 表里），所以差一个换行也算漂移。
"""
import difflib
import os

# 单条产物的差异行上限：platform_rest 的逐类表有 20574 行，全量打印会把日志冲掉。
MAX_DIFF_LINES = 24
# 单行字符上限：族判词一行能到 2000 字，CI 日志里只需要知道"漂在哪一行、开头长什么样"。
MAX_DIFF_CHARS = 220


def clip(line: str) -> str:
    return line if len(line) <= MAX_DIFF_CHARS else line[:MAX_DIFF_CHARS] + " …（本行截断，共 %d 字）" % len(line)


STATUS_SAME = "一致"
STATUS_MISSING = "磁盘上没有该文件"
STATUS_DIFF = "不一致"
STATUS_EOL = "仅行尾不同（磁盘是 CRLF，生成物是 LF）"


def repo_rel(path: str, repo: str) -> str:
    """把绝对路径折成仓库根相对的正斜杠路径，报告里好看也好 grep。"""
    return os.path.relpath(path, repo).replace(os.sep, "/")


def read_disk(path: str):
    """磁盘上的字节；文件不存在返回 None（不当"读失败"吞掉，缺失本身就是漂移）。"""
    if not os.path.isfile(path):
        return None
    with open(path, "rb") as handle:
        return handle.read()


def decode(raw: bytes) -> str:
    return raw.decode("utf-8", errors="replace").replace("\r\n", "\n")


def diff_lines(on_disk: bytes, generated: bytes):
    """生成物在前（`-` = 磁盘现状）、磁盘在后（`+` = 要改成什么）方向的 unified diff。"""
    left = decode(generated).splitlines()
    right = decode(on_disk).splitlines()
    return list(difflib.unified_diff(left, right, fromfile="生成物", tofile="磁盘", lineterm="", n=1))


def compare(artifacts, repo: str):
    """逐条产物与磁盘比对，返回报告条目（不改磁盘，也不抛异常）。"""
    reports = []
    for path, text in artifacts:
        want = text.encode("utf-8")
        got = read_disk(path)
        entry = {"path": path, "name": repo_rel(path, repo), "generated_bytes": len(want),
                 "disk_bytes": None if got is None else len(got), "status": STATUS_SAME, "diff": []}
        if got is None:
            entry["status"] = STATUS_MISSING
        elif got != want:
            entry["status"] = STATUS_EOL if got.replace(b"\r\n", b"\n") == want else STATUS_DIFF
            if entry["status"] == STATUS_DIFF:
                entry["diff"] = diff_lines(got, want)
        reports.append(entry)
    return reports


def is_clean(reports) -> bool:
    return all(entry["status"] == STATUS_SAME for entry in reports)


def render(reports, repo: str, mode: str) -> str:
    """人读的比对结果；`--check` 的失败输出要能直接指出「哪条产物的哪一行」漂移了。"""
    out = ["[%s] 生成物与磁盘比对（未写盘）：" % mode]
    bad = [entry for entry in reports if entry["status"] != STATUS_SAME]
    for entry in reports:
        if entry["status"] == STATUS_SAME:
            out.append("  一致   %s（%d 字节）" % (entry["name"], entry["generated_bytes"]))
        else:
            size = "缺失" if entry["disk_bytes"] is None else "%d 字节" % entry["disk_bytes"]
            out.append("  %s %s（生成 %d 字节 / 磁盘 %s）"
                       % (entry["status"], entry["name"], entry["generated_bytes"], size))
            for line in entry["diff"][:MAX_DIFF_LINES]:
                out.append("      " + clip(line))
            if len(entry["diff"]) > MAX_DIFF_LINES:
                out.append("      …另有 %d 行差异（前 %d 行已列出；整份重写：python scripts/verdict_table.py <该域>）"
                           % (len(entry["diff"]) - MAX_DIFF_LINES, MAX_DIFF_LINES))
    if bad:
        out.append("")
        out.append("不一致 %d / %d 条产物：%s"
                   % (len(bad), len(reports), "、".join(entry["name"] for entry in bad)))
        out.append("判词真源在 `scripts/verdict_table.py` 的 FAMILIES / PLATFORM_FAMILIES / MODULE_HEAP 表里，")
        out.append("生成物不许手改：改表 → `python scripts/verdict_table.py <域>` 重写 → `--check` 复核。")
    else:
        out.append("")
        out.append("一致 %d / %d 条产物。" % (len(reports), len(reports)))
    return "\n".join(out)


def write_all(artifacts):
    """默认档的写盘：`newline="\n"` 与 `encoding="utf-8"` 保持与历史行为逐字节一致。"""
    for path, text in artifacts:
        with open(path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)


if __name__ == "__main__":
    print("本文件是核对引擎，不单独跑。请用：")
    print("  python scripts/verdict_table.py --check  <域…>   # CI：不一致非零退出")
    print("  python scripts/verdict_table.py --dry-run <域…>  # 只看差异，不写盘")
    raise SystemExit(2)
