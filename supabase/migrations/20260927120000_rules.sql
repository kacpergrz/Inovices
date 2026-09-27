-- ==========================================================
-- Migracja: tabela `rules` dla panelu "Reguly"
-- Kategorie: vat_rate, payment_terms_default, vehicle_by_nip
-- ==========================================================

create table if not exists public.rules (
  id bigint generated always as identity primary key,
  category text not null,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text,
  unique (category, key)
);

comment on table public.rules is 'Konfigurowalne reguly biznesowe bota whatsapp-webhook (stawki VAT, domyslne terminy platnosci, auto-przypisanie faktur do pojazdow po NIP).';

alter table public.rules enable row level security;

create policy "Zalogowani czytaja reguly"
  on public.rules for select
  to authenticated
  using (true);

create policy "Zalogowani dodaja reguly"
  on public.rules for insert
  to authenticated
  with check (true);

create policy "Zalogowani edytuja reguly"
  on public.rules for update
  to authenticated
  using (true)
  with check (true);

create policy "Zalogowani usuwaja reguly"
  on public.rules for delete
  to authenticated
  using (true);

insert into public.rules (category, key, value) values
  ('vat_rate', 'PL', '{"paliwo_vat": 1.23, "myto_vat": 1.00}'),
  ('vat_rate', 'AT', '{"paliwo_vat": 1.20, "myto_vat": 1.20}'),
  ('vat_rate', 'DE', '{"paliwo_vat": 1.19, "myto_vat": 1.00}'),
  ('vat_rate', 'CZ', '{"paliwo_vat": 1.21, "myto_vat": 1.00}'),
  ('vat_rate', 'IT', '{"paliwo_vat": 1.22, "myto_vat": 1.22}'),
  ('vat_rate', 'FR', '{"paliwo_vat": 1.20, "myto_vat": 1.20}'),
  ('vat_rate', '_default', '{"paliwo_vat": 1.20, "myto_vat": 1.00}')
on conflict (category, key) do nothing;

insert into public.rules (category, key, value) values
  ('payment_terms_default', 'default', '{"days": 14}')
on conflict (category, key) do nothing;
