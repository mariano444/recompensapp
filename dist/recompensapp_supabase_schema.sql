-- ═══════════════════════════════════════════════════════════════
--  RECOMPENSAPP — Schema Supabase (PostgreSQL)
--  Ejecutar en: Supabase Dashboard → SQL Editor → New Query
--  Orden: extensiones → tablas → índices → RLS → funciones
-- ═══════════════════════════════════════════════════════════════

-- ── 0. Extensiones necesarias ──────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";


-- ══════════════════════════════════════════════════════════════
--  1. TABLA: profiles
--     Un registro por usuario (vinculado a auth.users de Supabase)
-- ══════════════════════════════════════════════════════════════
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text        not null default '',
  last_name     text        not null default '',
  description   text        not null default '',
  avatar_url    text,                         -- URL pública (Supabase Storage)
  cover_url     text,                         -- Banner del perfil
  slug          text unique,                  -- URL pública: recompensapp.app/{slug}
  pay_link      text,                         -- Link de pago externo (opcional)

  -- Mercado Pago (cifrado en app, almacenado como texto)
  mp_public_key text        default '',
  mp_access_token text      default '',
  mp_mode       text        default 'sandbox' check (mp_mode in ('sandbox','production')),

  -- Configuración de montos
  amt_min       integer     default 100,
  amt_suggestions text      default '100,500,1000,2000,5000', -- CSV

  -- Preferencias de visualización
  pref_show_amounts boolean  default true,
  pref_demo_mode    boolean  default true,

  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Trigger: actualiza updated_at automáticamente
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated
  before update on public.profiles
  for each row execute function public.handle_updated_at();

-- Trigger: crea perfil vacío al registrar usuario en auth.users
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, display_name, last_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', '')
  );
  return new;
end;
$$;

create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ══════════════════════════════════════════════════════════════
--  2. TABLA: reviews
--     Reseñas recibidas por un perfil
-- ══════════════════════════════════════════════════════════════
create table if not exists public.reviews (
  id            bigserial   primary key,
  profile_id    uuid        not null references public.profiles(id) on delete cascade,

  -- Datos del cliente
  reviewer_name text,                         -- null = Anónimo
  rating        smallint    not null check (rating between 1 and 5),
  service_type  text        not null,         -- 'Atención al cliente','Asesoramiento', etc.
  message       text,                         -- Comentario libre (nullable)
  emoji         text        default '🌟',     -- Avatar decorativo

  -- Recompensa / pago
  amount        integer     default 0,        -- Monto en ARS
  payment_id    text,                         -- ID de pago de Mercado Pago
  payment_status text       default 'pending' -- 'pending','approved','rejected','refunded'
                  check (payment_status in ('pending','approved','rejected','refunded')),

  -- Respuesta del dueño del perfil
  reply_text    text,
  reply_owner   text,
  reply_date    timestamptz,

  -- Visibilidad
  is_visible    boolean     default true,     -- false = oculta por el dueño

  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create trigger trg_reviews_updated
  before update on public.reviews
  for each row execute function public.handle_updated_at();

-- Índices de consulta frecuente
create index if not exists idx_reviews_profile_id   on public.reviews(profile_id);
create index if not exists idx_reviews_created_at   on public.reviews(created_at desc);
create index if not exists idx_reviews_rating        on public.reviews(rating);
create index if not exists idx_reviews_payment_status on public.reviews(payment_status);


-- ══════════════════════════════════════════════════════════════
--  3. TABLA: payments
--     Registro completo de cada transacción de Mercado Pago
-- ══════════════════════════════════════════════════════════════
create table if not exists public.payments (
  id                  bigserial   primary key,
  review_id           bigint      references public.reviews(id) on delete set null,
  profile_id          uuid        not null references public.profiles(id) on delete cascade,

  mp_payment_id       text        unique,     -- ID devuelto por MP
  mp_merchant_order   text,
  mp_preference_id    text,

  amount              integer     not null,
  currency            text        default 'ARS',
  status              text        default 'pending'
                        check (status in ('pending','approved','in_process','rejected','cancelled','refunded','charged_back')),
  status_detail       text,

  payment_method      text,                   -- 'credit_card','debit_card','account_money', etc.
  payment_type        text,

  payer_email         text,
  payer_name          text,

  raw_webhook         jsonb,                  -- Payload completo del webhook de MP

  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create trigger trg_payments_updated
  before update on public.payments
  for each row execute function public.handle_updated_at();

create index if not exists idx_payments_profile_id   on public.payments(profile_id);
create index if not exists idx_payments_mp_id        on public.payments(mp_payment_id);
create index if not exists idx_payments_status       on public.payments(status);
create index if not exists idx_payments_review_id    on public.payments(review_id);


-- ══════════════════════════════════════════════════════════════
--  4. TABLA: webhook_events
--     Cola de eventos de Mercado Pago (idempotencia)
-- ══════════════════════════════════════════════════════════════
create table if not exists public.webhook_events (
  id            bigserial   primary key,
  event_type    text        not null,         -- 'payment','merchant_order', etc.
  mp_event_id   text        unique,           -- Para evitar duplicados
  payload       jsonb       not null,
  processed     boolean     default false,
  error_msg     text,
  received_at   timestamptz default now(),
  processed_at  timestamptz
);

create index if not exists idx_webhook_events_processed on public.webhook_events(processed);
create index if not exists idx_webhook_events_mp_id     on public.webhook_events(mp_event_id);


-- ══════════════════════════════════════════════════════════════
--  5. TABLA: service_types
--     Catálogo configurable de tipos de servicio por perfil
-- ══════════════════════════════════════════════════════════════
create table if not exists public.service_types (
  id          bigserial   primary key,
  profile_id  uuid        references public.profiles(id) on delete cascade,
  name        text        not null,
  emoji       text        default '✨',
  is_active   boolean     default true,
  sort_order  smallint    default 0,
  created_at  timestamptz default now()
);

-- Tipos de servicio predeterminados (globales, profile_id = null)
insert into public.service_types (profile_id, name, emoji, sort_order) values
  (null, 'Atención al cliente', '💬', 1),
  (null, 'Asesoramiento',       '🧭', 2),
  (null, 'Trabajo realizado',   '🛠️', 3),
  (null, 'Soporte técnico',     '⚙️', 4),
  (null, 'Producto',            '📦', 5),
  (null, 'Otro',                '✨', 6)
on conflict do nothing;


-- ══════════════════════════════════════════════════════════════
--  6. TABLA: profile_stats (vista materializada manual)
--     Caché de estadísticas para carga rápida del landing
-- ══════════════════════════════════════════════════════════════
create table if not exists public.profile_stats (
  profile_id      uuid primary key references public.profiles(id) on delete cascade,
  total_reviews   integer default 0,
  avg_rating      numeric(3,2) default 0,
  five_star_count integer default 0,
  total_rewards   integer default 0,   -- Suma total de montos en ARS
  last_review_at  timestamptz,
  updated_at      timestamptz default now()
);

-- Función: recalcula stats de un perfil
create or replace function public.refresh_profile_stats(p_profile_id uuid)
returns void language plpgsql as $$
begin
  insert into public.profile_stats (
    profile_id, total_reviews, avg_rating,
    five_star_count, total_rewards, last_review_at, updated_at
  )
  select
    p_profile_id,
    count(*)                                            as total_reviews,
    coalesce(round(avg(rating)::numeric, 2), 0)        as avg_rating,
    count(*) filter (where rating = 5)                  as five_star_count,
    coalesce(sum(amount) filter (where amount > 0), 0)  as total_rewards,
    max(created_at)                                     as last_review_at,
    now()
  from public.reviews
  where profile_id = p_profile_id
    and is_visible = true
  on conflict (profile_id) do update set
    total_reviews   = excluded.total_reviews,
    avg_rating      = excluded.avg_rating,
    five_star_count = excluded.five_star_count,
    total_rewards   = excluded.total_rewards,
    last_review_at  = excluded.last_review_at,
    updated_at      = now();
end;
$$;

-- Trigger: actualiza stats cuando se inserta/modifica/borra una review
create or replace function public.trg_refresh_stats()
returns trigger language plpgsql as $$
begin
  if (TG_OP = 'DELETE') then
    perform public.refresh_profile_stats(OLD.profile_id);
  else
    perform public.refresh_profile_stats(NEW.profile_id);
  end if;
  return null;
end;
$$;

create trigger trg_reviews_stats
  after insert or update or delete on public.reviews
  for each row execute function public.trg_refresh_stats();


-- ══════════════════════════════════════════════════════════════
--  7. ROW LEVEL SECURITY (RLS)
-- ══════════════════════════════════════════════════════════════

-- profiles: cada usuario solo accede/modifica su propio perfil
alter table public.profiles enable row level security;

create policy "profiles: select propio" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles: update propio" on public.profiles
  for update using (auth.uid() = id);

-- Acceso público de lectura para el perfil público (slug lookup)
create policy "profiles: select publico por slug" on public.profiles
  for select using (slug is not null);


-- reviews: dueño ve todas; público ve solo las visibles
alter table public.reviews enable row level security;

create policy "reviews: dueño ve todas" on public.reviews
  for all using (auth.uid() = profile_id);

create policy "reviews: insert anónimo (formulario público)" on public.reviews
  for insert with check (true);  -- Cualquier visitante puede dejar reseña

create policy "reviews: select públicas visibles" on public.reviews
  for select using (is_visible = true);


-- payments: solo el dueño del perfil
alter table public.payments enable row level security;

create policy "payments: dueño" on public.payments
  for all using (auth.uid() = profile_id);


-- webhook_events: solo service role (backend)
alter table public.webhook_events enable row level security;
-- Sin policies públicas: acceso solo via service_role key


-- profile_stats: lectura pública
alter table public.profile_stats enable row level security;

create policy "stats: select publico" on public.profile_stats
  for select using (true);

create policy "stats: update propio" on public.profile_stats
  for update using (auth.uid() = profile_id);


-- service_types: lectura pública, escritura del dueño
alter table public.service_types enable row level security;

create policy "service_types: select publico" on public.service_types
  for select using (true);

create policy "service_types: manage propio" on public.service_types
  for all using (auth.uid() = profile_id or profile_id is null);


-- ══════════════════════════════════════════════════════════════
--  8. VISTAS ÚTILES
-- ══════════════════════════════════════════════════════════════

-- Vista: perfil público completo (join profiles + stats)
create or replace view public.v_public_profiles as
  select
    p.id,
    p.display_name,
    p.description,
    p.avatar_url,
    p.cover_url,
    p.slug,
    s.total_reviews,
    s.avg_rating,
    s.five_star_count,
    s.total_rewards,
    s.last_review_at
  from public.profiles p
  left join public.profile_stats s on s.profile_id = p.id
  where p.slug is not null;

-- Vista: historial de recompensas (solo pagos aprobados)
create or replace view public.v_reward_history as
  select
    r.id as review_id,
    r.profile_id,
    r.reviewer_name,
    r.service_type,
    r.rating,
    r.message,
    r.amount,
    r.created_at,
    pay.mp_payment_id,
    pay.status as payment_status
  from public.reviews r
  left join public.payments pay on pay.review_id = r.id
  where r.amount > 0;


-- ══════════════════════════════════════════════════════════════
--  9. FUNCIÓN: slug automático desde display_name
-- ══════════════════════════════════════════════════════════════
create or replace function public.slugify(input text)
returns text language plpgsql as $$
declare
  result text;
begin
  result := lower(input);
  result := regexp_replace(result, '[áàäâ]', 'a', 'g');
  result := regexp_replace(result, '[éèëê]', 'e', 'g');
  result := regexp_replace(result, '[íìïî]', 'i', 'g');
  result := regexp_replace(result, '[óòöô]', 'o', 'g');
  result := regexp_replace(result, '[úùüû]', 'u', 'g');
  result := regexp_replace(result, '[ñ]', 'n', 'g');
  result := regexp_replace(result, '[^a-z0-9\s-]', '', 'g');
  result := regexp_replace(result, '\s+', '-', 'g');
  result := regexp_replace(result, '-+', '-', 'g');
  result := trim(both '-' from result);
  return result;
end;
$$;


-- ══════════════════════════════════════════════════════════════
--  10. STORAGE BUCKETS (ejecutar como service_role o en Storage UI)
-- ══════════════════════════════════════════════════════════════

-- Bucket para avatares y covers de perfiles
insert into storage.buckets (id, name, public)
values ('profile-media', 'profile-media', true)
on conflict do nothing;

-- Policy de storage: solo el dueño sube, público descarga
create policy "profile-media: upload dueño" on storage.objects
  for insert with check (
    bucket_id = 'profile-media'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "profile-media: select publico" on storage.objects
  for select using (bucket_id = 'profile-media');

create policy "profile-media: delete dueño" on storage.objects
  for delete using (
    bucket_id = 'profile-media'
    and auth.uid()::text = (storage.foldername(name))[1]
  );


-- ══════════════════════════════════════════════════════════════
--  FIN DEL SCHEMA
--  Tablas creadas: profiles, reviews, payments,
--                  webhook_events, service_types, profile_stats
--  Vistas:         v_public_profiles, v_reward_history
--  Funciones:      handle_new_user, refresh_profile_stats,
--                  slugify, handle_updated_at
-- ══════════════════════════════════════════════════════════════
