create extension if not exists pgcrypto;

create table if not exists public.barbearias (
  id uuid primary key default gen_random_uuid(),
  dono_id uuid,
  owner_user_id uuid references auth.users(id) on delete cascade,
  nome text not null,
  slug text not null unique,
  logo_url text,
  telefone_whatsapp text,
  endereco text,
  descricao text,
  cor_principal text default '#ffffff',
  aceitar_agendamento_online boolean default true,
  intervalo_minutos integer default 30,
  ativo boolean default true,
  status text default 'ativa',
  created_at timestamptz default now()
);

create table if not exists public.horarios_funcionamento (
  id uuid primary key default gen_random_uuid(),
  barbearia_id uuid references public.barbearias(id) on delete cascade,
  dia_semana integer not null check (dia_semana between 0 and 6),
  ativo boolean default true,
  abre time default '08:00',
  fecha time default '18:00',
  unique (barbearia_id, dia_semana)
);

create table if not exists public.servicos (
  id uuid primary key default gen_random_uuid(),
  barbearia_id uuid references public.barbearias(id) on delete cascade,
  nome text not null,
  descricao text,
  duracao_min integer default 30,
  preco numeric(10,2) default 0,
  ativo boolean default true,
  ordem integer default 0,
  created_at timestamptz default now()
);

create table if not exists public.barbeiros (
  id uuid primary key default gen_random_uuid(),
  barbearia_id uuid references public.barbearias(id) on delete cascade,
  nome text not null,
  cargo text,
  foto_url text,
  ativo boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  barbearia_id uuid references public.barbearias(id) on delete cascade,
  nome text not null,
  telefone text not null,
  email text,
  created_at timestamptz default now()
);

create table if not exists public.agendamentos (
  id uuid primary key default gen_random_uuid(),
  barbearia_id uuid references public.barbearias(id) on delete cascade,
  cliente_id uuid references public.clientes(id) on delete set null,
  servico_id uuid references public.servicos(id) on delete set null,
  barbeiro_id uuid references public.barbeiros(id) on delete set null,
  data_agendamento date not null,
  hora_inicio time not null,
  hora_fim time,
  status text default 'pendente',
  observacao text,
  created_at timestamptz default now()
);

create table if not exists public.barbearia_whatsapp (
  barbearia_id uuid primary key references public.barbearias(id) on delete cascade,
  evolution_api_url text not null,
  evolution_api_key text not null,
  instance_name text not null unique,
  ativo boolean default true,
  connected_at timestamptz,
  updated_at timestamptz default now()
);

create table if not exists public.whatsapp_logs (
  id uuid primary key default gen_random_uuid(),
  barbearia_id uuid references public.barbearias(id) on delete set null,
  agendamento_id uuid references public.agendamentos(id) on delete set null,
  numero text,
  tipo text,
  mensagem text,
  status text,
  resposta jsonb,
  erro text,
  created_at timestamptz default now()
);

create table if not exists public.webhook_logs (
  id uuid primary key default gen_random_uuid(),
  barbearia_id uuid references public.barbearias(id) on delete set null,
  evento text,
  payload jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_barbearias_slug on public.barbearias(slug);
create index if not exists idx_barbearias_owner on public.barbearias(owner_user_id);
create index if not exists idx_agendamentos_data on public.agendamentos(barbearia_id, data_agendamento, hora_inicio);
create index if not exists idx_clientes_telefone on public.clientes(barbearia_id, telefone);
create index if not exists idx_whatsapp_logs_agendamento on public.whatsapp_logs(agendamento_id, tipo, status);
