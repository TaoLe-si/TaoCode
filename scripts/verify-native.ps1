param(
    [Parameter(Mandatory = $true)][string]$Project,
    [Parameter(Mandatory = $true)][string]$Build,
    [string]$Target
)
# Standalone native verifier: loads the MSVC x64 environment (same discovery as
# build-native.ps1) and configures/builds/runs ONE throwaway CMake project into a
# private build directory, so parallel work never touches build/ or the root
# CMakeLists.txt. $Target is an executable to run after building (optional).
$ErrorActionPreference = 'Stop'
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (!(Test-Path $vswhere)) { throw 'Install Visual Studio C++ desktop build tools first.' }
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$vs) { throw 'No MSVC x64 toolchain was found.' }
$cmake = Join-Path $vs 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
$ninja = Join-Path $vs 'Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe'
$vcvars = Join-Path $vs 'VC\Auxiliary\Build\vcvars64.bat'
if (!(Test-Path $cmake)) { throw 'Enable the C++ CMake tools component in Visual Studio.' }
# Import the MSVC x64 environment (cl/link on PATH) into this process, exactly
# like build-native.ps1, so the standalone project finds a working compiler.
$compilerEnvironment = & $env:ComSpec /d /c "call `"$vcvars`" >nul && set"
if ($LASTEXITCODE -ne 0) { throw 'Failed to load the MSVC environment.' }
foreach ($line in $compilerEnvironment) {
    $separator = $line.IndexOf('=')
    if ($separator -gt 0) {
        [Environment]::SetEnvironmentVariable($line.Substring(0, $separator), $line.Substring($separator + 1), 'Process')
    }
}
& $cmake -S $Project -B $Build -G Ninja -DCMAKE_BUILD_TYPE=Release "-DCMAKE_MAKE_PROGRAM=$ninja"
if ($LASTEXITCODE -ne 0) { throw "configure failed: $LASTEXITCODE" }
$buildArgs = @('--build', $Build, '--parallel')
if ($Target) { $buildArgs += @('--target', $Target) }
& $cmake @buildArgs
if ($LASTEXITCODE -ne 0) { throw "build failed: $LASTEXITCODE" }
if ($Target) {
    $exe = Join-Path $Build $Target
    if (!(Test-Path $exe)) { $exe = Get-ChildItem -Path $Build -Filter "$Target.exe" -Recurse | Select-Object -First 1 -ExpandProperty FullName }
    if (!$exe) { throw "built target '$Target' not found under $Build" }
    Write-Output "--- run $exe ---"
    & $exe
    if ($LASTEXITCODE -ne 0) { throw "test failed: exit $LASTEXITCODE" }
}
Write-Output "verify OK: $Build"
