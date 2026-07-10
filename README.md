# BarberOS - SaaS de agendamento para barbearias

## Setup rapido

1. No Supabase, rode o arquivo `supabase-schema.sql` no SQL Editor.
2. Em Authentication, crie o usuario do dono do SaaS com e-mail e senha.
3. Na Vercel, configure as variaveis do `.env.example` em Production e Preview.
4. Faca redeploy na Vercel depois de alterar variaveis.
5. Acesse `/admin-saas`, entre com o e-mail listado em `SAAS_ADMIN_EMAILS` e crie a barbearia pelo formulario.
6. O dono da barbearia entra em `/painel` com o e-mail e senha criados no Super Admin.
7. No painel do dono, abra WhatsApp, informe apenas o telefone e clique em gerar QR Code.
   A URL e a API Key da Evolution ficam nas variaveis da Vercel.

## Links

- Super Admin: `/admin-saas`
- Painel da barbearia: `/painel`
- Agenda publica: `/b/slug-da-barbearia`
- Cron de lembretes: `/api/cron-lembretes?secret=SUA_CHAVE`

## App Android do painel

O projeto ja vem preparado para gerar um APK do painel do dono da barbearia.

Como gerar no Windows:

1. Instale o Android Studio.
2. Durante a instalacao, aceite instalar o Android SDK e o Java/JDK.
3. Reinicie o computador se o terminal ainda nao reconhecer o Java.
4. No projeto, rode `npm run android:sync`.
5. Rode `npm run android:open` para abrir no Android Studio.
6. No Android Studio, use `Build > Build Bundle(s) / APK(s) > Build APK(s)`.

O app abre direto o painel publicado em `https://barbearia-virtual.vercel.app/painel`, entao cada atualizacao na Vercel ja aparece no aplicativo sem precisar gerar um APK novo.

Atalho sem APK:

- No Chrome do celular, abra `https://barbearia-virtual.vercel.app/painel`.
- Toque em `Adicionar a tela inicial`.
- O painel instala como app pelo navegador.

## Lembrete de 30 minutos

O endpoint `/api/cron-lembretes?secret=SUA_CHAVE` envia a mensagem para o cliente quando faltam cerca de 30 minutos para o horario marcado.

Para funcionar sozinho, chame esse link a cada 5 minutos usando um agendador externo, como cron-job.org, UptimeRobot ou GitHub Actions. No plano Hobby da Vercel, o cron interno nao e indicado para lembrete de 30 minutos porque nao roda com essa frequencia.

## Observacoes

- A Evolution API fica nas variaveis da Vercel: `EVOLUTION_API_URL` e `EVOLUTION_API_KEY`.
- A instancia do WhatsApp e criada automaticamente pelo slug da loja, por exemplo `barbearia-minha-loja`.
- A tela publica so entra em modo demonstracao com `/agendar?demo=1`. Se uma barbearia real falhar, ela mostra erro em vez de simular agendamento.
- Sempre que mudar variaveis na Vercel, faca um novo deploy para a Function receber os valores.
