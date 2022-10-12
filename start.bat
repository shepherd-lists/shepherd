@echo off
docker compose up --build -d
docker compose logs -f