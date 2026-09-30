#!/bin/sh
set -eu
mkdir -p backups
cp "${DB_PATH:-./data/estoque.db}" "backups/estoque-$(date +%Y%m%d-%H%M%S).db"
