@echo off
cd /d "C:\Users\OSCAR\Desktop\G I T H U B R E P O S\MiniBase-Web\api"
python -m uvicorn main:app --host 127.0.0.1 --port 8000
pause
