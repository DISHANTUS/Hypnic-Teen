@echo off
REM  Hypnic Teen - Fun World, with a link that does not change.
REM
REM  Fill in the two lines below once, from your ngrok dashboard, then run this
REM  file whenever you want the studio up. Double-click is enough.
REM
REM    token   https://dashboard.ngrok.com/get-started/your-authtoken
REM    domain  https://dashboard.ngrok.com/domains   (claim the free one)

set NGROK_AUTHTOKEN=
set NGROK_DOMAIN=

REM  Your own Hypnic ID, so notices you post are signed by the studio.
set OWNER_ID=

cd /d "%~dp0"

if "%NGROK_AUTHTOKEN%"=="" (
  echo.
  echo   No ngrok token set yet - starting with a temporary link instead.
  echo   Open START-ONLINE.cmd in Notepad and paste your token to fix that.
  echo.
)

npm start
pause
