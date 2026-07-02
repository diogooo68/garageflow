-- ============================================================
-- GarageFlow Sales Engine — Supabase schema (Postgres)
-- Migration 0001: initial schema
-- ============================================================
-- Run this in Supabase: SQL Editor > New query > paste > Run
-- Idempotent-ish: uses IF NOT EXISTS where possible.
-- ============================================================

create extension if not exists "pgcrypto";      -- gen_random_uuid()
create extension if not exists "pg_trgm";        -- fuzzy dedup on names

-- ------------------------------------------------------------
-- ENUMS
-- ------------------------------------------------------------
do $$ begin
  create type lead_status as enum (
    'nova',
    'analisada',
    'contactada',
    'respondeu',
    'interesse',
    'demonstracao_marcada',
    'cliente',
    'perdida'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type message_type as enum ('primeiro_contacto','followup_1','followup_2','followup_final','resposta','manual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type message_channel as enum ('email','whatsapp','sms','manual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type message_status as enum ('rascunho','enviada','entregue','aberta','respondida','falhou','suprimida');
exception when duplicate_object then null; end $$;

do $$ begin
  create type agent_status as enum ('idle','a_correr','erro','pausado');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- LEADS (a oficina como oportunidade comercial)
-- ------------------------------------------------------------
create table if not exists leads (
  id                uuid primary key default gen_random_uuid(),
  nome_oficina      text not null,
  email             text,
  telefone          text,
  website           text,
  morada            text,
  cidade            text,
  regiao            text,
  pais              text default 'PT',
  google_place_id   text unique,          -- chave de dedup principal
  google_maps_url   text,
  rating            numeric(2,1),
  total_reviews     int,
  categoria         text,
  estado            lead_status not null default 'nova',
  score             int check (score between 0 and 100),
  score_motivo      text,
  research_resumo   text,                  -- "porque beneficia do GarageFlow"
  notas             text,
  fonte             text default 'google_places',
  data_criacao      timestamptz not null default now(),
  ultimo_contacto   timestamptz,
  proxima_accao     timestamptz,
  updated_at        timestamptz not null default now()
);

-- Dedup de reforço (nome+cidade normalizados) além do place_id
create unique index if not exists leads_nome_cidade_uidx
  on leads (lower(nome_oficina), lower(coalesce(cidade,'')));
create index if not exists leads_estado_idx        on leads (estado);
create index if not exists leads_score_idx          on leads (score desc);
create index if not exists leads_proxima_accao_idx  on leads (proxima_accao);
create index if not exists leads_telefone_idx       on leads (telefone);
create index if not exists leads_nome_trgm_idx      on leads using gin (nome_oficina gin_trgm_ops);

-- ------------------------------------------------------------
-- CONTACTOS (pessoas dentro da oficina)
-- ------------------------------------------------------------
create table if not exists contactos (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references leads(id) on delete cascade,
  nome          text,
  cargo         text,
  email         text,
  telefone      text,
  principal     boolean default false,
  data_criacao  timestamptz not null default now()
);
create index if not exists contactos_lead_idx on contactos (lead_id);

-- ------------------------------------------------------------
-- MENSAGENS (cada contacto enviado/recebido)
-- ------------------------------------------------------------
create table if not exists mensagens (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references leads(id) on delete cascade,
  contacto_id   uuid references contactos(id) on delete set null,
  tipo          message_type not null,
  canal         message_channel not null default 'email',
  assunto       text,
  conteudo      text not null,
  estado        message_status not null default 'rascunho',
  provider_id   text,                       -- id do email no ESP (Resend etc.)
  data_envio    timestamptz,
  data_resposta timestamptz,
  resposta      text,                        -- corpo da resposta recebida
  agente        text,                        -- agente que gerou a mensagem
  data_criacao  timestamptz not null default now()
);
create index if not exists mensagens_lead_idx    on mensagens (lead_id);
create index if not exists mensagens_estado_idx   on mensagens (estado);
create index if not exists mensagens_tipo_idx     on mensagens (tipo);
create index if not exists mensagens_provider_idx on mensagens (provider_id);

-- ------------------------------------------------------------
-- REUNIOES (demos marcadas via Calendly)
-- ------------------------------------------------------------
create table if not exists reunioes (
  id                 uuid primary key default gen_random_uuid(),
  lead_id            uuid not null references leads(id) on delete cascade,
  calendly_event_id  text unique,
  data_reuniao       timestamptz,
  estado             text default 'marcada',   -- marcada | realizada | no_show | cancelada
  link               text,
  notas              text,
  data_criacao       timestamptz not null default now()
);
create index if not exists reunioes_lead_idx on reunioes (lead_id);

-- ------------------------------------------------------------
-- AGENTES (estado da equipa IA)
-- ------------------------------------------------------------
create table if not exists agentes (
  id             uuid primary key default gen_random_uuid(),
  nome           text unique not null,
  funcao         text,
  estado         agent_status not null default 'idle',
  tarefa_atual   text,
  ultima_accao   timestamptz,
  historico      jsonb default '[]'::jsonb
);

-- ------------------------------------------------------------
-- LOGS (auditoria de tudo o que os agentes fazem)
-- ------------------------------------------------------------
create table if not exists logs (
  id          uuid primary key default gen_random_uuid(),
  agente      text not null,
  lead_id     uuid references leads(id) on delete set null,
  accao       text not null,
  motivo      text,
  resultado   text,                        -- ok | erro | skip
  detalhe     jsonb,
  data        timestamptz not null default now()
);
create index if not exists logs_agente_idx on logs (agente);
create index if not exists logs_lead_idx   on logs (lead_id);
create index if not exists logs_data_idx   on logs (data desc);

-- ------------------------------------------------------------
-- ESTATISTICAS (snapshot diario para o Analytics Agent)
-- ------------------------------------------------------------
create table if not exists estatisticas (
  id                 uuid primary key default gen_random_uuid(),
  dia                date not null unique,
  novas_leads        int default 0,
  contactos_enviados int default 0,
  respostas          int default 0,
  interessados       int default 0,
  demos_marcadas     int default 0,
  novos_clientes     int default 0,
  taxa_resposta      numeric(5,2),
  taxa_conversao     numeric(5,2),
  recomendacoes      text,
  detalhe            jsonb,
  data_criacao       timestamptz not null default now()
);

-- ------------------------------------------------------------
-- SUPRESSAO (RGPD / opt-out / bounces) — nunca contactar de novo
-- ------------------------------------------------------------
create table if not exists supressoes (
  id       uuid primary key default gen_random_uuid(),
  email    text,
  dominio  text,
  motivo   text,               -- opt_out | bounce | reclamacao | pedido_rgpd
  data     timestamptz not null default now()
);
create unique index if not exists supressoes_email_uidx on supressoes (lower(email));
create index if not exists supressoes_dominio_idx on supressoes (lower(dominio));

-- ------------------------------------------------------------
-- Trigger: manter updated_at nos leads
-- ------------------------------------------------------------
create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists leads_touch on leads;
create trigger leads_touch before update on leads
  for each row execute function touch_updated_at();

-- ------------------------------------------------------------
-- Seed dos agentes
-- ------------------------------------------------------------
insert into agentes (nome, funcao) values
  ('prospect','Encontrar novas oficinas via Google Places'),
  ('research','Analisar cada oficina e resumir o encaixe com o GarageFlow'),
  ('qualification','Pontuar 0-100 com justificacao'),
  ('sales','Criar mensagens comerciais personalizadas'),
  ('followup','Sequencia de follow-ups D0/D3/D7/D14'),
  ('reply','Analisar respostas e decidir proxima accao'),
  ('meeting','Marcar demos via Calendly'),
  ('analytics','Relatorio diario e recomendacoes')
on conflict (nome) do nothing;

-- ------------------------------------------------------------
-- View: pipeline resumido (para dashboard)
-- ------------------------------------------------------------
create or replace view v_pipeline as
select estado, count(*) as total, avg(score)::int as score_medio
from leads group by estado;
