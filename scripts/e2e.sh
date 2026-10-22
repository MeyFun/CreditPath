#!/usr/bin/env sh
set -eu

# Запускает e2e внутри backend-контейнера: httpx уже установлен,
# база и моки доступны по внутренней сети Docker.
if ! docker compose ps --status running --services 2>/dev/null | grep -qx "backend"; then
  echo "Сначала запустите: docker compose up --build -d" >&2
  exit 1
fi

docker compose exec -T -e E2E_BASE_URL=http://localhost:8000/api backend python - < scripts/e2e.py
