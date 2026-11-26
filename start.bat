@echo off
cd /d "%~dp0"
if not exist node_modules call npm install
start "" http://localhost:5173
npx vite --port 5173
