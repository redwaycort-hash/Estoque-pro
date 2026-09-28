#!/bin/sh
set -eu
mkdir -p backups
STAMP=$(date +"%Y-%m-%d_%H-%M-%S")
docker compose exec -T estoque sh -c 'cp /app/estoque.db /tmp/estoque.db'
docker compose cp estoque:/app/estoque.db "./backups/estoque-$STAMP.db"
echo "Backup criado: backups/estoque-$STAMP.db"
