# Estoque Pro — V4 com IA e comando de voz

Sistema de estoque com autenticação no servidor, SQLite, permissões de administrador/usuário e assistente de IA.

## IA e voz
- Assistente de IA via OpenAI Responses API.
- Comando por texto e por voz pelo navegador (Chrome/Android normalmente oferece SpeechRecognition).
- A IA pode consultar estoque para usuários autenticados.
- Para ações de estoque, a IA interpreta o comando e pede confirmação antes de executar.
- Somente administradores podem confirmar entradas, saídas e cadastros.
- A chave da OpenAI fica no servidor, nunca no JavaScript do navegador.

Exemplos:
- “Quanto tenho de botão de ferro?”
- “Quais produtos estão abaixo do estoque mínimo?”
- “Dar entrada de 100 botões de ferro, referência Corte 3598.”
- “Dar saída de 20 zíperes pretos.”
- “Cadastrar fita azul com 200 unidades.”

## Variáveis
Copie `.env.example` para `.env` e configure:
- `SESSION_SECRET`: segredo longo e aleatório.
- `ADMIN_PASSWORD`: senha inicial do administrador.
- `OPENAI_API_KEY`: sua chave da OpenAI.
- `OPENAI_MODEL`: por padrão `gpt-5.6-luna`.

A API da OpenAI é usada no servidor; não coloque a chave em `public/index.html`.
