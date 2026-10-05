"""从 TaoCode 的 WER dump 里还原崩溃现场：异常码/参数、出错模块，以及**每个线程**栈上的调用链。

用法：python scripts/dump_fault.py build/crashes/TaoCode.exe.<pid>.dmp [每线程输出条数]

只用 dbghelp（Windows SDK 自带），不需要 cdb/windbg。
栈的部分扫的是"线程栈上落在 TaoCode.exe 代码段里的字"（候选返回地址）——
比 StackWalk64 稳，且在栈被处理器帧搞乱时照样出结果。
"""
import ctypes, struct, sys
from ctypes import wintypes

DBGHELP = ctypes.WinDLL("dbghelp", use_last_error=True)


class SYMBOL_INFOW(ctypes.Structure):
    _fields_ = [("SizeOfStruct", wintypes.ULONG), ("TypeIndex", wintypes.ULONG), ("Reserved", ctypes.c_ulonglong * 2),
                ("Index", wintypes.ULONG), ("Size", wintypes.ULONG), ("ModBase", ctypes.c_ulonglong),
                ("Flags", wintypes.ULONG), ("Value", ctypes.c_ulonglong), ("Address", ctypes.c_ulonglong),
                ("Register", wintypes.ULONG), ("Scope", wintypes.ULONG), ("Tag", wintypes.ULONG),
                ("NameLen", wintypes.ULONG), ("MaxNameLen", wintypes.ULONG), ("Name", ctypes.c_wchar * 2000)]


class IMAGEHLP_LINEW64(ctypes.Structure):
    _fields_ = [("SizeOfStruct", wintypes.DWORD), ("Key", ctypes.c_void_p), ("LineNumber", wintypes.DWORD),
                ("FileName", wintypes.LPWSTR), ("Address", ctypes.c_ulonglong)]


def stream(blob, number):
    signature, _, count = struct.unpack_from("<IIL", blob, 0)
    assert signature == 0x504D444D, "not a minidump"
    for i in range(count):
        offset = 32 + i * 12
        stream_type, size, rva = struct.unpack_from("<IIL", blob, offset)
        if stream_type == number:
            return blob[rva:rva + size]
    return None


def memory_ranges(blob):
    ranges = []
    stream64 = stream(blob, 9)
    if stream64:
        count, base_rva = struct.unpack_from("<QQ", stream64, 0)
        pos = 16
        for _ in range(count):
            start, size = struct.unpack_from("<QQ", stream64, pos)
            ranges.append((start, size, base_rva))
            pos += 16
            base_rva += size
        return ranges
    list32 = stream(blob, 5)
    if list32:
        count = struct.unpack_from("<L", list32, 0)[0]
        for i in range(count):
            start, size, rva = struct.unpack_from("<QLL", list32, 4 + i * 16)
            ranges.append((start, size, rva))
    return ranges


def read_at(blob, ranges, address, size):
    for start, length, file_offset in ranges:
        if start <= address and address + size <= start + length:
            offset = file_offset + (address - start)
            return blob[offset:offset + size]
    return None


def main():
    path = sys.argv[1]
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 16
    blob = open(path, "rb").read()
    exception, modules, threads = stream(blob, 6), stream(blob, 4), stream(blob, 3)
    if not exception:
        print("no exception stream")
        return
    thread_id = struct.unpack_from("<L", exception, 0)[0]
    code, _flags = struct.unpack_from("<LL", exception, 8)
    address = struct.unpack_from("<Q", exception, 24)[0]
    parameters = struct.unpack_from("<15Q", exception, 40)
    print(f"exception code=0x{code:08X} address=0x{address:016X} thread={thread_id}")
    print("parameters:", [hex(value) for value in parameters[:4]])

    entries = []
    count = struct.unpack_from("<L", modules, 0)[0]
    for i in range(count):
        # MINIDUMP_MODULE：BaseOfImage +0(ULONG64)、SizeOfImage +8、CheckSum +12、TimeDateStamp +16、
        # ModuleNameRva +20（**ULONG32**，不是 ULONG64 —— 写错一位会把模块名读成空串）。
        entry = 4 + i * 108
        base = struct.unpack_from("<Q", modules, entry)[0]
        size = struct.unpack_from("<L", modules, entry + 8)[0]
        name_rva = struct.unpack_from("<L", modules, entry + 20)[0]
        # MINIDUMP_STRING = { ULONG32 Length（**字节数**）; WCHAR Buffer[] } —— 字符串从 RVA+4 开始。
        name_len = struct.unpack_from("<L", blob, name_rva)[0]
        name_off = name_rva + 4
        entries.append((base, size, blob[name_off:name_off + name_len].decode("utf-16-le", "replace")))

    def which(addr):
        best = None
        for base, size, name in entries:
            if base <= addr < base + size and (best is None or base > best[0]):
                best = (base, size, name)
        return (best[2], addr - best[0]) if best else None

    hit = which(address)
    print("faulting module:", f"{hit[0]} +0x{hit[1]:X}" if hit else "unknown")

    # 必须显式声明 argtypes：不声明时 ctypes 把 base 当 c_int，64 位地址会 OverflowError。
    DBGHELP.SymSetOptions.argtypes = [wintypes.DWORD]
    DBGHELP.SymInitializeW.argtypes = [wintypes.HANDLE, wintypes.LPCWSTR, wintypes.BOOL]
    DBGHELP.SymLoadModuleExW.argtypes = [wintypes.HANDLE, wintypes.HANDLE, wintypes.LPCWSTR, wintypes.LPCWSTR,
                                         ctypes.c_ulonglong, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD]
    DBGHELP.SymLoadModuleExW.restype = ctypes.c_ulonglong
    DBGHELP.SymFromAddrW.argtypes = [wintypes.HANDLE, ctypes.c_ulonglong, ctypes.POINTER(ctypes.c_ulonglong),
                                     ctypes.POINTER(SYMBOL_INFOW)]
    DBGHELP.SymGetLineFromAddrW64.argtypes = [wintypes.HANDLE, ctypes.c_ulonglong, ctypes.POINTER(wintypes.DWORD),
                                              ctypes.POINTER(IMAGEHLP_LINEW64)]
    DBGHELP.SymSetOptions(0x2 | 0x4)
    DBGHELP.SymInitializeW(0, None, False)
    for base, size, name in entries:
        if name.lower().endswith("taocode.exe"):
            DBGHELP.SymLoadModuleExW(0, None, name, None, base, size, None, 0)

    def describe(addr):
        symbol = SYMBOL_INFOW(); symbol.SizeOfStruct = 88; symbol.MaxNameLen = 1999
        displacement = ctypes.c_ulonglong(0)
        if DBGHELP.SymFromAddrW(0, ctypes.c_ulonglong(addr), ctypes.byref(displacement), ctypes.byref(symbol)):
            text = f"{symbol.Name}+0x{displacement.value:X}"
            line = IMAGEHLP_LINEW64(); line.SizeOfStruct = ctypes.sizeof(IMAGEHLP_LINEW64)
            if DBGHELP.SymGetLineFromAddrW64(0, ctypes.c_ulonglong(addr), ctypes.byref(ctypes.c_ulong(0)), ctypes.byref(line)):
                text += f"  [{ctypes.c_wchar_p(line.FileName).value}:{line.LineNumber}]"
            return text
        module = which(addr)
        return f"<{module[0]}+0x{module[1]:X}>" if module else None

    print("fault symbol:", describe(address))
    ranges = memory_ranges(blob)
    print("memory ranges:", len(ranges))

    count = struct.unpack_from("<L", threads, 0)[0]
    print(f"threads: {count}; scanning stacks for return addresses into TaoCode.exe")
    for i in range(count):
        entry = 4 + i * 48
        tid = struct.unpack_from("<L", threads, entry)[0]
        context_rva = struct.unpack_from("<L", threads, entry + 44)[0]
        context = blob[context_rva:context_rva + 1232]
        rip = struct.unpack_from("<Q", context, 0xF8)[0]
        rsp = struct.unpack_from("<Q", context, 0x98)[0]
        hits = []
        for offset in range(0, 16384, 8):
            raw = read_at(blob, ranges, rsp + offset, 8)
            if raw is None:
                break
            value = struct.unpack("<Q", raw)[0]
            module = which(value)
            if module and module[0].lower().endswith("taocode.exe"):
                text = describe(value)
                if text:
                    hits.append((offset, text))
                    if len(hits) >= limit:
                        break
        if not hits:
            continue
        mark = "   <== 崩溃线程" if tid == thread_id else ""
        print(f"\n--- thread {tid}  rip=0x{rip:X} rsp=0x{rsp:X}{mark}")
        for offset, text in hits:
            print(f"   +0x{offset:05X}  {text}")


if __name__ == "__main__":
    main()
