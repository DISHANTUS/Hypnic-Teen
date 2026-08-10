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

REM  Where feedback should land. MAIL_PASS is a Google App Password, not
REM  your account password — Gmail refuses those over SMTP. Generate one at
REM  https://myaccount.google.com/apppasswords (needs 2-step verification on).
set MAIL_TO=
set MAIL_USER=
set MAIL_PASS=

REM  Your own Hypnic ID, so notices you post are signed by the studio.
set OWNER_ID=

cd /d "%~dp0"

if "%NGROK_AUTHTOKEN%"=="" (
  echo.
  echo   No ngrok token set yet - starting with a temporary link instead.
  echo   Open START-ONLINE.cmd in Notepad and paste your token to fix that.
  echo.
)


REM  Sports Betting settles itself off the internet rather than off anybody in
REM  the room, so it needs a key per sport. Both are free and neither wants a
REM  card. Leave them blank and the table still works  it follows a demo match
REM  that plays itself, with real chips on it.
REM
REM    cricket   https://cricketdata.org  (sign up, the key is on the dashboard)
REM    football  https://dashboard.api-football.com
REM
REM  Both free tiers are around a hundred calls a day, and one match uses most
REM  of that. The table spends two per market, so a longer betting window is
REM  literally a cheaper evening.
set CRICKET_API_KEY=
set API_FOOTBALL_KEY=

npm start
pause
