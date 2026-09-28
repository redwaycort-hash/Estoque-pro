# Publicar o Estoque Pro na internet

## Opção recomendada
Use um servidor VPS Linux (Ubuntu 22.04/24.04) com domínio próprio.

### 1. Servidor
Instale Docker e Docker Compose Plugin no VPS.

### 2. Arquivos
Envie esta pasta para o servidor e entre nela.

### 3. Configuração
Copie `.env.example` para `.env`:
`cp .env.example .env`

Troque `SESSION_SECRET` por uma chave aleatória longa.

### 4. Subir
`docker compose up -d --build`

O sistema ficará disponível na porta 3000.

## HTTPS / domínio
Na frente do container, use um proxy reverso (Caddy ou Nginx) e aponte seu domínio para o VPS. O Caddy pode emitir e renovar certificado TLS automaticamente.

Exemplo conceitual de Caddyfile:
```
estoque.seudominio.com {
    reverse_proxy estoque:3000
}
```

Se Caddy estiver no mesmo Docker Compose, coloque ambos na mesma network.

## Backup
O banco fica no volume `estoque_data`. Execute:
`sh backup.sh`

Guarde os arquivos de backup fora do VPS também.

## Primeiro acesso
Usuário: `redway`
Senha: `25198615`

Troque a senha depois de entrar, quando a tela de administração de usuários for adicionada/ativada.

## Observação importante
A senha inicial está no `.env` apenas para criar o administrador na primeira execução. O banco armazena o hash bcrypt. Não publique o arquivo `.env` nem o coloque no Git.
