@echo off
call "C:\Program Files\Microsoft Visual Studio\18\Enterprise\VC\Auxiliary\Build\vcvarsall.bat" x64 >nul 2>&1
cd /d D:\TaoCode
D:\AndroidSdk\cmake\3.22.1\bin\cmake.exe --build D:\TaoCode\build\next 2>&1
