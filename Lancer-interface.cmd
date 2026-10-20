@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
echo Passage Photos - preparation de l'interface
if not exist ".venv\Scripts\python.exe" (
    python -m venv .venv
    if errorlevel 1 goto error
)
".venv\Scripts\python.exe" -c "import requests, requests_toolbelt" >nul 2>nul
if errorlevel 1 (
    ".venv\Scripts\python.exe" -m pip install -r requirements.txt
    if errorlevel 1 goto error
)
".venv\Scripts\python.exe" -m photos_pcloud web %*
if errorlevel 1 goto error
exit /b 0
:error
echo.
echo Le lancement a echoue. Verifiez que Python 3.11 ou plus est installe.
echo Les messages ci-dessus indiquent la cause.
pause
exit /b 1
