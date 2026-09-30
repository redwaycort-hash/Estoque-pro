# Deploy — Estoque Pro V21 no Render

## GitHub
Suba todos os arquivos deste pacote na raiz do repositório. Não envie `.env`, banco SQLite nem `node_modules`.

## Render
Use o `render.yaml` como Blueprint ou crie um Web Service com Runtime Docker. Configure `ADMIN_PASSWORD` e `OPENAI_API_KEY` como secrets.

O serviço possui health check em `/health` e o banco usa `/app/data/estoque.db` em Persistent Disk.
