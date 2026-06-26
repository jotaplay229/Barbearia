# BarberOS - SaaS de agendamento para barbearias

## Setup rapido

1. No Supabase, rode o arquivo `supabase-schema.sql` no SQL Editor.
2. Em Authentication, crie o usuario do dono do SaaS com e-mail e senha.
3. Na Vercel, configure as variaveis do `.env.example` em Production e Preview.
4. Faca redeploy na Vercel depois de alterar variaveis.
5. Acesse `/admin-saas`, entre com o e-mail listado em `SAAS_ADMIN_EMAILS` e crie a barbearia pelo formulario.
6. O dono da barbearia entra em `/painel` com o e-mail e senha criados no Super Admin.
7. No painel do dono, abra WhatsApp e configure:
   - Evolution API URL: URL publica da sua Evolution
   - API Key: `GLOBAL_API_KEY` da Evolution
   - Nome da instancia: um nome unico, por exemplo `barbearia-prime`

## Links

- Super Admin: `/admin-saas`
- Painel da barbearia: `/painel`
- Agenda publica: `/b/slug-da-barbearia`
- Cron de lembretes: `/api/cron-lembretes?secret=SUA_CHAVE`

## Observacoes

- A Evolution API nao fica nas variaveis da Vercel. Ela e configurada por barbearia no painel do dono.
- A tela publica so entra em modo demonstracao com `/agendar?demo=1`. Se uma barbearia real falhar, ela mostra erro em vez de simular agendamento.
- Sempre que mudar variaveis na Vercel, faca um novo deploy para a Function receber os valores.
