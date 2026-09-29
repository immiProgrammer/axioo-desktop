@echo off
setlocal enabledelayedexpansion

title Axioo Desktop Installer
echo.
echo =======================================================
echo              Axioo Desktop - Setup Installer
echo =======================================================
echo.

set "REPO=immiProgrammer/axioo-desktop"
set "CACHE_DIR=%TEMP%\AxiooDesktopInstaller"
set "LOCAL_SETUP="
set "INSTALLER_PATH="
set "REMOTE_INFO="
set "LATEST_TAG="
set "SETUP_NAME="
set "DOWNLOAD_URL="

:: Check if an Axioo setup executable already exists in the script's directory
for %%f in ("%~dp0Axioo-Desktop-Setup-*.exe") do (
    if exist "%%~ff" (
        set "LOCAL_SETUP=%%~ff"
        goto :CheckRemote
    )
)
for %%f in ("%~dp0Axioo*Setup*.exe") do (
    if exist "%%~ff" (
        set "LOCAL_SETUP=%%~ff"
        goto :CheckRemote
    )
)

:CheckRemote
echo [*] Checking for the latest Axioo Desktop release on GitHub...

:: Query GitHub Releases API for the latest release asset
for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference = 'SilentlyContinue'; " ^
    "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
    "try { " ^
    "    $headers = @{'User-Agent'='Axioo-Installer'}; " ^
    "    if ($env:GH_TOKEN) { $headers['Authorization'] = 'Bearer ' + $env:GH_TOKEN }; " ^
    "    $r = Invoke-RestMethod -Uri 'https://api.github.com/repos/%REPO%/releases/latest' -Headers $headers; " ^
    "    $setup = $r.assets | Where-Object { $_.name -like 'Axioo*Setup*.exe' } | Select-Object -First 1; " ^
    "    if ($setup) { Write-Output ('FOUND|' + $r.tag_name + '|' + $setup.name + '|' + $setup.browser_download_url) } else { Write-Output 'NONE' } " ^
    "} catch { Write-Output 'NONE' }"`) do (
    set "REMOTE_INFO=%%i"
)

if not defined REMOTE_INFO goto :HandleMissingInstaller
if "!REMOTE_INFO:~0,6!"=="FOUND|" (
    for /f "tokens=2,3* delims=|" %%a in ("!REMOTE_INFO!") do (
        set "LATEST_TAG=%%a"
        set "SETUP_NAME=%%b"
        set "DOWNLOAD_URL=%%c"
    )
) else (
    goto :HandleMissingInstaller
)

if not defined DOWNLOAD_URL goto :HandleMissingInstaller
if "!DOWNLOAD_URL!"=="" goto :HandleMissingInstaller

echo [+] Latest release found: !LATEST_TAG! (!SETUP_NAME!)

:: Check if current directory has the exact latest file
if exist "%~dp0!SETUP_NAME!" (
    echo [*] Latest installer is already present in current directory.
    set "INSTALLER_PATH=%~dp0!SETUP_NAME!"
    goto :PrepareInstall
)

:: Check if cache directory has the exact latest file
if not exist "%CACHE_DIR%" mkdir "%CACHE_DIR%" >nul 2>&1
if exist "%CACHE_DIR%\!SETUP_NAME!" (
    echo [*] Latest installer is already cached.
    set "INSTALLER_PATH=%CACHE_DIR%\!SETUP_NAME!"
    goto :PrepareInstall
)

:: Download the latest installer
echo [*] Downloading !SETUP_NAME!...
set "INSTALLER_PATH=%CACHE_DIR%\!SETUP_NAME!"
if defined GH_TOKEN (
    curl.exe -L --fail --progress-bar -H "Authorization: Bearer %GH_TOKEN%" -o "!INSTALLER_PATH!" "!DOWNLOAD_URL!"
) else (
    curl.exe -L --fail --progress-bar -o "!INSTALLER_PATH!" "!DOWNLOAD_URL!"
)
if errorlevel 1 (
    echo [!] curl download failed, attempting fallback download via PowerShell...
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "$ErrorActionPreference = 'Stop'; " ^
        "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
        "$wc = New-Object System.Net.WebClient; " ^
        "if ($env:GH_TOKEN) { $wc.Headers.Add('Authorization', 'Bearer ' + $env:GH_TOKEN) }; " ^
        "$wc.DownloadFile('!DOWNLOAD_URL!', '!INSTALLER_PATH!')"
    if errorlevel 1 (
        echo [x] Failed to download installer from GitHub Releases.
        goto :HandleMissingInstaller
    )
)
goto :PrepareInstall

:HandleMissingInstaller
if defined LOCAL_SETUP (
    echo [*] Remote check unavailable or no release published on GitHub yet.
    echo [*] Using local installer: %LOCAL_SETUP%
    set "INSTALLER_PATH=%LOCAL_SETUP%"
    goto :PrepareInstall
)

echo.
echo [x] Error: Could not find or download the Axioo Desktop setup installer.
echo     - Repository: https://github.com/%REPO%
echo     - Note: If this repository is private, make it public or set the GH_TOKEN environment variable.
echo     - Check release status at: https://github.com/%REPO%/releases
echo.
pause
exit /b 1

:PrepareInstall
if not exist "!INSTALLER_PATH!" (
    echo [x] Error: Installer file not found at: !INSTALLER_PATH!
    pause
    exit /b 1
)

:: Unblock the file to remove Windows SmartScreen Mark-of-the-Web
echo [*] Unblocking file to prevent security warnings...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Unblock-File -LiteralPath '!INSTALLER_PATH!'" >nul 2>&1

echo.
echo =======================================================
echo Starting Axioo Desktop Installation...
echo =======================================================
echo.

start "" "!INSTALLER_PATH!"

echo [+] Installer launched successfully.
ping 127.0.0.1 -n 3 >nul 2>&1
exit /b 0
