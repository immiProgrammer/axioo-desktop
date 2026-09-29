echo [DEBUG 1]
@echo off
echo [DEBUG 2]
setlocal enabledelayedexpansion
echo [DEBUG 3]

echo [DEBUG 4]
title Axioo Desktop Installer
echo [DEBUG 5]
echo.
echo [DEBUG 6]
echo =======================================================
echo [DEBUG 7]
echo              Axioo Desktop - Setup Installer
echo [DEBUG 8]
echo =======================================================
echo [DEBUG 9]
echo.
echo [DEBUG 10]

echo [DEBUG 11]
set "REPO=immiProgrammer/axioo-desktop"
echo [DEBUG 12]
set "CACHE_DIR=%TEMP%\AxiooDesktopInstaller"
echo [DEBUG 13]
set "LOCAL_SETUP="
echo [DEBUG 14]
set "INSTALLER_PATH="
echo [DEBUG 15]
set "REMOTE_INFO="
echo [DEBUG 16]
set "LATEST_TAG="
echo [DEBUG 17]
set "SETUP_NAME="
echo [DEBUG 18]
set "EXPECTED_SIZE="
echo [DEBUG 19]
set "DOWNLOAD_URL="
echo [DEBUG 20]

echo [DEBUG 21]
:: Check if an Axioo setup executable already exists in the script's directory
echo [DEBUG 22]
for %%f in ("%~dp0Axioo-Desktop-Setup-*.exe") do set "LOCAL_SETUP=%%~ff"
echo [DEBUG 23]
if not defined LOCAL_SETUP (
echo [DEBUG 24]
    for %%f in ("%~dp0Axioo*Setup*.exe") do set "LOCAL_SETUP=%%~ff"
echo [DEBUG 25]
)
echo [DEBUG 26]

echo [DEBUG 27]
echo [*] Checking for the latest Axioo Desktop release on GitHub...
echo [DEBUG 28]

echo [DEBUG 29]
:: Query GitHub Releases API for the latest release asset and file size
echo [DEBUG 30]
for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -ExecutionPolicy Bypass -Command ^
echo [DEBUG 31]
    "$ErrorActionPreference = 'SilentlyContinue'; " ^
echo [DEBUG 32]
    "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
echo [DEBUG 33]
    "try { " ^
echo [DEBUG 34]
    "    $headers = @{'User-Agent'='Axioo-Installer'}; " ^
echo [DEBUG 35]
    "    if ($env:GH_TOKEN) { $headers['Authorization'] = 'Bearer ' + $env:GH_TOKEN }; " ^
echo [DEBUG 36]
    "    $r = Invoke-RestMethod -Uri 'https://api.github.com/repos/%REPO%/releases/latest' -Headers $headers; " ^
echo [DEBUG 37]
    "    $setup = $r.assets | Where-Object { $_.name -like 'Axioo*Setup*.exe' } | Select-Object -First 1; " ^
echo [DEBUG 38]
    "    if ($setup) { Write-Output ('FOUND|' + $r.tag_name + '|' + $setup.name + '|' + $setup.size + '|' + $setup.browser_download_url) } else { Write-Output 'NONE' } " ^
echo [DEBUG 39]
    "} catch { Write-Output 'NONE' }"`) do (
echo [DEBUG 40]
    set "REMOTE_INFO=%%i"
echo [DEBUG 41]
)
echo [DEBUG 42]

echo [DEBUG 43]
if not defined REMOTE_INFO goto HandleMissingInstaller
echo [DEBUG 44]
if not "!REMOTE_INFO:~0,6!"=="FOUND|" goto HandleMissingInstaller
echo [DEBUG 45]

echo [DEBUG 46]
for /f "tokens=2,3,4* delims=|" %%a in ("!REMOTE_INFO!") do (
echo [DEBUG 47]
    set "LATEST_TAG=%%a"
echo [DEBUG 48]
    set "SETUP_NAME=%%b"
echo [DEBUG 49]
    set "EXPECTED_SIZE=%%c"
echo [DEBUG 50]
    set "DOWNLOAD_URL=%%d"
echo [DEBUG 51]
)
echo [DEBUG 52]

echo [DEBUG 53]
if not defined DOWNLOAD_URL goto HandleMissingInstaller
echo [DEBUG 54]
if "!DOWNLOAD_URL!"=="" goto HandleMissingInstaller
echo [DEBUG 55]

echo [DEBUG 56]
echo [+] Latest online release: !LATEST_TAG! (!SETUP_NAME!)
echo [DEBUG 57]

echo [DEBUG 58]
:: Check if current directory already has the exact latest installer file
echo [DEBUG 59]
set "CANDIDATE="
echo [DEBUG 60]
if exist "%~dp0!SETUP_NAME!" set "CANDIDATE=%~dp0!SETUP_NAME!"
echo [DEBUG 61]
if defined CANDIDATE goto CheckCandidate
echo [DEBUG 62]

echo [DEBUG 63]
:: Check if cache directory already has the exact latest installer file
echo [DEBUG 64]
if not exist "%CACHE_DIR%" mkdir "%CACHE_DIR%" >nul 2>&1
echo [DEBUG 65]
if exist "%CACHE_DIR%\!SETUP_NAME!" set "CANDIDATE=%CACHE_DIR%\!SETUP_NAME!"
echo [DEBUG 66]
if defined CANDIDATE goto CheckCandidate
echo [DEBUG 67]

echo [DEBUG 68]
goto DoDownload
echo [DEBUG 69]

echo [DEBUG 70]
:CheckCandidate
echo [DEBUG 71]
set "CANDIDATE_SIZE="
echo [DEBUG 72]
for %%A in ("!CANDIDATE!") do set "CANDIDATE_SIZE=%%~zA"
echo [DEBUG 73]
if not defined CANDIDATE_SIZE goto DoDownload
echo [DEBUG 74]

echo [DEBUG 75]
if not defined EXPECTED_SIZE goto CheckMinSize
echo [DEBUG 76]
if "!EXPECTED_SIZE!"=="" goto CheckMinSize
echo [DEBUG 77]

echo [DEBUG 78]
if not "!CANDIDATE_SIZE!"=="!EXPECTED_SIZE!" goto CandidateMismatch
echo [DEBUG 79]
echo [*] Verified exact latest installer (!CANDIDATE_SIZE! bytes): !SETUP_NAME!
echo [DEBUG 80]
set "INSTALLER_PATH=!CANDIDATE!"
echo [DEBUG 81]
goto VerifyAndInstall
echo [DEBUG 82]

echo [DEBUG 83]
:CandidateMismatch
echo [DEBUG 84]
echo [!] Cached installer size (!CANDIDATE_SIZE! bytes) differs from release (!EXPECTED_SIZE! bytes).
echo [DEBUG 85]
del /f /q "!CANDIDATE!" >nul 2>&1
echo [DEBUG 86]
goto DoDownload
echo [DEBUG 87]

echo [DEBUG 88]
:CheckMinSize
echo [DEBUG 89]
if !CANDIDATE_SIZE! LEQ 1000000 goto DoDownload
echo [DEBUG 90]
echo [*] Found latest installer: !SETUP_NAME! (!CANDIDATE_SIZE! bytes)
echo [DEBUG 91]
set "INSTALLER_PATH=!CANDIDATE!"
echo [DEBUG 92]
goto VerifyAndInstall
echo [DEBUG 93]

echo [DEBUG 94]
:DoDownload
echo [DEBUG 95]
echo [*] Downloading latest release: !SETUP_NAME!...
echo [DEBUG 96]
if not exist "%CACHE_DIR%" mkdir "%CACHE_DIR%" >nul 2>&1
echo [DEBUG 97]
set "INSTALLER_PATH=%CACHE_DIR%\!SETUP_NAME!"
echo [DEBUG 98]
set "DL_SUCCESS=0"
echo [DEBUG 99]

echo [DEBUG 100]
if defined GH_TOKEN (
echo [DEBUG 101]
    curl.exe -L --fail --progress-bar -H "Authorization: Bearer %GH_TOKEN%" -o "!INSTALLER_PATH!" "!DOWNLOAD_URL!"
echo [DEBUG 102]
) else (
echo [DEBUG 103]
    curl.exe -L --fail --progress-bar -o "!INSTALLER_PATH!" "!DOWNLOAD_URL!"
echo [DEBUG 104]
)
echo [DEBUG 105]
if not errorlevel 1 set "DL_SUCCESS=1"
echo [DEBUG 106]

echo [DEBUG 107]
if "!DL_SUCCESS!"=="0" (
echo [DEBUG 108]
    echo [!] curl download failed, attempting fallback download via PowerShell...
echo [DEBUG 109]
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
echo [DEBUG 110]
        "$ErrorActionPreference = 'Stop'; " ^
echo [DEBUG 111]
        "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
echo [DEBUG 112]
        "$wc = New-Object System.Net.WebClient; " ^
echo [DEBUG 113]
        "if ($env:GH_TOKEN) { $wc.Headers.Add('Authorization', 'Bearer ' + $env:GH_TOKEN) }; " ^
echo [DEBUG 114]
        "$wc.DownloadFile('!DOWNLOAD_URL!', '!INSTALLER_PATH!')"
echo [DEBUG 115]
    if not errorlevel 1 set "DL_SUCCESS=1"
echo [DEBUG 116]
)
echo [DEBUG 117]

echo [DEBUG 118]
if "!DL_SUCCESS!"=="0" (
echo [DEBUG 119]
    echo [x] Failed to download installer from GitHub Releases.
echo [DEBUG 120]
    goto HandleMissingInstaller
echo [DEBUG 121]
)
echo [DEBUG 122]

echo [DEBUG 123]
goto VerifyAndInstall
echo [DEBUG 124]

echo [DEBUG 125]
:HandleMissingInstaller
echo [DEBUG 126]
if not defined LOCAL_SETUP goto FailNoInstaller
echo [DEBUG 127]
echo [*] Remote check unavailable (offline or repository is private).
echo [DEBUG 128]
echo [*] Falling back to local installer: %LOCAL_SETUP%
echo [DEBUG 129]
set "INSTALLER_PATH=%LOCAL_SETUP%"
echo [DEBUG 130]
goto VerifyAndInstall
echo [DEBUG 131]

echo [DEBUG 132]
:FailNoInstaller
echo [DEBUG 133]
echo.
echo [DEBUG 134]
echo [x] Error: Could not find or download the Axioo Desktop setup installer.
echo [DEBUG 135]
echo     - Repository: https://github.com/%REPO%
echo [DEBUG 136]
echo     - Note: If this repository is private, make it public or set the GH_TOKEN environment variable.
echo [DEBUG 137]
echo     - Check release status at: https://github.com/%REPO%/releases
echo [DEBUG 138]
echo.
echo [DEBUG 139]
pause
echo [DEBUG 140]
exit /b 1
echo [DEBUG 141]

echo [DEBUG 142]
:VerifyAndInstall
echo [DEBUG 143]
if not exist "!INSTALLER_PATH!" (
echo [DEBUG 144]
    echo [x] Error: Installer file not found at: !INSTALLER_PATH!
echo [DEBUG 145]
    pause
echo [DEBUG 146]
    exit /b 1
echo [DEBUG 147]
)
echo [DEBUG 148]

echo [DEBUG 149]
:: Verify file version metadata using PowerShell
echo [DEBUG 150]
for /f "usebackq tokens=*" %%v in (`powershell -NoProfile -ExecutionPolicy Bypass -Command ^
echo [DEBUG 151]
    "$ErrorActionPreference = 'SilentlyContinue'; " ^
echo [DEBUG 152]
    "$v = (Get-Item '!INSTALLER_PATH!').VersionInfo.ProductVersion; " ^
echo [DEBUG 153]
    "if ($v) { Write-Output $v } else { (Get-Item '!INSTALLER_PATH!').VersionInfo.FileVersion }"`) do (
echo [DEBUG 154]
    set "VERIFIED_VERSION=%%v"
echo [DEBUG 155]
)
echo [DEBUG 156]

echo [DEBUG 157]
if defined VERIFIED_VERSION (
echo [DEBUG 158]
    echo [+] Installer Version Verified: !VERIFIED_VERSION!
echo [DEBUG 159]
)
echo [DEBUG 160]

echo [DEBUG 161]
:: Unblock the file to remove Windows SmartScreen Mark-of-the-Web
echo [DEBUG 162]
echo [*] Unblocking file to prevent security warnings...
echo [DEBUG 163]
powershell -NoProfile -ExecutionPolicy Bypass -Command "Unblock-File -LiteralPath '!INSTALLER_PATH!'" >nul 2>&1
echo [DEBUG 164]

echo [DEBUG 165]
echo.
echo [DEBUG 166]
echo =======================================================
echo [DEBUG 167]
echo Starting Axioo Desktop Installation...
echo [DEBUG 168]
echo =======================================================
echo [DEBUG 169]
echo.
echo [DEBUG 170]

echo [DEBUG 171]
start "" "!INSTALLER_PATH!"
echo [DEBUG 172]

echo [DEBUG 173]
echo [+] Installer launched successfully.
echo [DEBUG 174]
ping 127.0.0.1 -n 3 >nul 2>&1
echo [DEBUG 175]
exit /b 0
echo [DEBUG 176]
