# Templates de e-mail do Supabase

Use estes arquivos no painel do Supabase para deixar os e-mails de confirmacao e alteracao de senha com a identidade do BarberOS.

## URL Configuration

No Supabase, va em `Authentication > URL Configuration` e confira:

- `Site URL`: `https://barbearia-virtual.vercel.app`
- `Redirect URLs`:
  - `https://barbearia-virtual.vercel.app/confirmar-email`
  - `https://barbearia-virtual.vercel.app/alterar-senha`
  - `https://barbearia-virtual.vercel.app/painel`

## Confirm sign up

Em `Authentication > Emails > Confirm sign up`:

- `Subject`: `Confirme seu acesso ao BarberOS`
- `Body`: cole o conteudo de `confirm-sign-up.html`

O botao do e-mail abre:

`https://barbearia-virtual.vercel.app/confirmar-email`

Depois de confirmar, a pagina leva o dono para `/painel`.

## Reset password

Em `Authentication > Emails > Reset password`:

- `Subject`: `Alterar senha do BarberOS`
- `Body`: cole o conteudo de `reset-password.html`

O botao do e-mail abre:

`https://barbearia-virtual.vercel.app/alterar-senha`

Nessa pagina o dono digita a nova senha e depois volta para `/painel`.
