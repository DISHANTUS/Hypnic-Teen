@echo off
title Hypnic Teen - Fun World
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher.ps1"
if errorlevel 1 pause
