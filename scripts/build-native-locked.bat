@echo off
rem Serialized native build. Several agents share D:\TaoCode\build, and two concurrent
rem cmake --build runs on one binary directory corrupt each other's object files.
rem "mkdir" is atomic on Windows, so a lock directory is the mutex.
set LOCKDIR=D:\TaoCode\build\.buildlock
set WAITED=0
:acquire
mkdir "%LOCKDIR%" >nul 2>&1
if not errorlevel 1 goto got
rem Stale lock from a crashed run: clear it if it is older than 10 minutes.
forfiles /p D:\TaoCode\build /m .buildlock /d -0 >nul 2>&1
if "%WAITED%"=="120" (
  echo BUILD_LOCK_TIMEOUT
  rmdir "%LOCKDIR%" >nul 2>&1
  exit /b 1
)
timeout /t 5 /nobreak >nul
set /a WAITED+=1
goto acquire
:got
call "C:\Program Files\Microsoft Visual Studio\18\Enterprise\VC\Auxiliary\Build\vcvarsall.bat" x64
set SDK_ROOT=C:\Program Files (x86)\Windows Kits\10
set SDK_VER=10.0.26100.0
set INCLUDE=%INCLUDE%;%SDK_ROOT%\Include\%SDK_VER%\ucrt;%SDK_ROOT%\Include\%SDK_VER%\um;%SDK_ROOT%\Include\%SDK_VER%\shared;%SDK_ROOT%\Include\%SDK_VER%\winrt
set LIB=%LIB%;%SDK_ROOT%\Lib\%SDK_VER%\ucrt\x64;%SDK_ROOT%\Lib\%SDK_VER%\um\x64
set CMAKE_BIN=C:\Program Files\Microsoft Visual Studio\18\Enterprise\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin
"%CMAKE_BIN%\cmake.exe" --build D:\TaoCode\build --parallel
set RC=%ERRORLEVEL%
rmdir "%LOCKDIR%" >nul 2>&1
exit /b %RC%
