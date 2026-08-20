-- Rode isso uma vez no SQL Editor do Supabase (Project > SQL Editor > New query).
-- Tabelas prefixadas com "naipe_" de propósito: esse projeto Supabase é
-- compartilhado com outras coisas, então isso mantém os dados do Naipe
-- Azul isolados por nome, sem mexer em nenhuma tabela já existente.
--
-- RLS ligado e sem nenhuma policy — só a service_role key (usada pelo
-- backend) consegue ler/escrever. A chave anon (pública) não enxerga
-- nada aqui, o que importa porque naipe_orders guarda CPF, telefone e
-- endereço.

create table if not exists naipe_orders (
  id            text primary key,
  method        text not null,
  plan          text not null,
  plan_name     text,
  value         numeric not null,
  subscribed    boolean not null default false,
  name          text,
  email         text,
  cpf           text,
  phone         text,
  address       jsonb not null default '{}'::jsonb,
  status        text not null,
  installments  integer,
  created_at    bigint not null,
  updated_at    bigint
);

create index if not exists naipe_orders_created_at_idx on naipe_orders (created_at desc);
create index if not exists naipe_orders_status_idx on naipe_orders (status);

alter table naipe_orders enable row level security;

create table if not exists naipe_funnel_events (
  id          text primary key,
  type        text not null,
  meta        jsonb not null default '{}'::jsonb,
  created_at  bigint not null
);

create index if not exists naipe_funnel_events_type_idx on naipe_funnel_events (type);

alter table naipe_funnel_events enable row level security;
