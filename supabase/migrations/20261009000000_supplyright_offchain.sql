-- SupplyRight offchain data (private commercial details, documents, production dependency map).
--
-- Access model: the browser never talks to these tables directly. The Next.js server authenticates the
-- caller with a wallet signature, checks onchain roles, and then uses the service-role key. Row Level
-- Security is enabled with NO policies, so the anon/authenticated keys cannot read or write anything.
-- Only hashes of these records are published onchain.

-- ---------------------------------------------------------------------------
-- Supply agreements (registration requests -> registrar review -> minted supply right)
-- ---------------------------------------------------------------------------
create table public.agreements (
  id                uuid primary key default gen_random_uuid(),
  chain_id          integer not null,
  token_id          integer,
  status            text not null default 'SUBMITTED'
                    check (status in ('SUBMITTED', 'VERIFIED', 'MINTED', 'REJECTED')),
  buyer_address     text not null,
  buyer_name        text not null,
  supplier_name     text not null,
  supplier_ref      text not null,
  supplier_salt     text not null,
  supplier_ref_hash text not null,
  material_name     text not null,
  material_code     text not null,
  quantity          numeric(20, 3) not null check (quantity > 0),
  unit              text not null default 'MT',
  contract_value    numeric(38, 18) not null check (contract_value > 0),
  delivery_deadline timestamptz not null,
  po_number         text not null,
  incoterms         text,
  notes             text,
  po_hash           text not null,
  agreement_hash    text not null,
  supplier_ack_hash text,
  review_note       text,
  reviewed_by       text,
  mint_tx_hash      text,
  created_by        text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (chain_id, po_hash)
);

create index agreements_buyer_idx on public.agreements (lower(buyer_address));
create index agreements_status_idx on public.agreements (chain_id, status);

-- ---------------------------------------------------------------------------
-- Private documents. Bytes live in the private Storage bucket; sha256 is the value referenced onchain.
-- ---------------------------------------------------------------------------
create table public.documents (
  id           uuid primary key default gen_random_uuid(),
  agreement_id uuid references public.agreements (id) on delete set null,
  context_key  text,
  kind         text not null check (kind in (
                 'PURCHASE_ORDER', 'SUPPLY_AGREEMENT', 'SUPPLIER_REFERENCE', 'SUPPLIER_ACK',
                 'DELIVERY_NOTE', 'PROTECTION_TERMS', 'UNDERWRITING_MEMO', 'CLAIM_EVIDENCE',
                 'VERIFIER_REPORT', 'REJECTION_REPORT', 'OBJECTION', 'RECOVERY_UPDATE',
                 'CLOSING_MEMO', 'OTHER')),
  file_name    text not null,
  mime_type    text not null,
  size_bytes   integer not null check (size_bytes >= 0),
  sha256       text not null check (sha256 ~ '^0x[0-9a-f]{64}$'),
  storage_path text not null unique,
  uploaded_by  text not null,
  created_at   timestamptz not null default now()
);

create index documents_sha256_idx on public.documents (sha256);
create index documents_agreement_idx on public.documents (agreement_id);
create index documents_context_idx on public.documents (context_key);

-- ---------------------------------------------------------------------------
-- Production Dependency Mapper (offchain business logic; never published onchain)
-- ---------------------------------------------------------------------------
create table public.materials (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  code                   text not null unique,
  criticality            text not null check (criticality in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  agreement_id           uuid references public.agreements (id) on delete set null,
  po_hash                text,
  reported_status        text check (reported_status in ('ON_TRACK', 'REPORTED_DELAY', 'ARRIVED')),
  alternative_suppliers  integer not null default 0 check (alternative_suppliers >= 0),
  alternative_lead_days  integer check (alternative_lead_days >= 0),
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table public.products (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  sku                text not null unique,
  daily_output_units integer check (daily_output_units >= 0),
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table public.dependencies (
  id                     uuid primary key default gen_random_uuid(),
  material_id            uuid not null references public.materials (id) on delete cascade,
  product_id             uuid not null references public.products (id) on delete cascade,
  is_blocking            boolean not null default true,
  est_disruption_days    integer not null default 0 check (est_disruption_days >= 0),
  est_financial_exposure numeric(38, 18) not null default 0 check (est_financial_exposure >= 0),
  notes                  text,
  created_at             timestamptz not null default now(),
  unique (material_id, product_id)
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger agreements_touch before update on public.agreements
  for each row execute function public.touch_updated_at();
create trigger materials_touch before update on public.materials
  for each row execute function public.touch_updated_at();
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Lock everything down: RLS on, no policies, no grants to anon/authenticated.
-- ---------------------------------------------------------------------------
alter table public.agreements   enable row level security;
alter table public.documents    enable row level security;
alter table public.materials    enable row level security;
alter table public.products     enable row level security;
alter table public.dependencies enable row level security;

revoke all on public.agreements, public.documents, public.materials, public.products, public.dependencies
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Private Storage bucket for documents (10 MB per file). No storage policies => only service role.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('supply-documents', 'supply-documents', false, 10485760)
on conflict (id) do nothing;
