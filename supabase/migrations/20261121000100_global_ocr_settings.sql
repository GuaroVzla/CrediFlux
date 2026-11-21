-- Configuración OCR GLOBAL (singleton). Sustituye la configuración por usuario
-- que la UI de Ajustes Admin guardaba en la fila user_settings del administrador.
-- Sólo service_role puede leerla/escribirla: no se crean políticas para
-- authenticated, de modo que ningún usuario estándar puede inspeccionarla.

create table if not exists public.admin_ocr_settings (
  id                      text primary key default 'global' check (id = 'global'),
  ai_provider             text check (ai_provider in ('openai', 'gemini', 'ocrspace', 'tesseract')),
  ocr_api_keys            jsonb not null default '{}'::jsonb,
  ocr_endpoints           jsonb not null default '{}'::jsonb,
  ocr_models              jsonb not null default '{}'::jsonb,
  ocr_thresholds          jsonb not null default '{}'::jsonb,
  ocr_confidence_min      numeric(5, 4) not null default 0.8 check (ocr_confidence_min between 0 and 1),
  ai_routing_rules        jsonb not null default '{}'::jsonb,
  ai_auto_assign_enabled  boolean not null default true,
  updated_by              uuid references auth.users (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table public.admin_ocr_settings is 'Configuración global del motor OCR; credenciales cifradas en reposo por la capa de aplicación.';
comment on column public.admin_ocr_settings.ocr_api_keys is 'API Keys cifradas con AES-256-GCM. Nunca se exponen al cliente.';

alter table public.admin_ocr_settings enable row level security;

-- RLS sin políticas = acceso denegado a anon/authenticated. service_role lo omite.
revoke all on public.admin_ocr_settings from anon, authenticated;
grant all on public.admin_ocr_settings to service_role;

drop trigger if exists admin_ocr_settings_set_updated_at on public.admin_ocr_settings;
create trigger admin_ocr_settings_set_updated_at
  before update on public.admin_ocr_settings
  for each row execute function public.set_updated_at();

-- Backfill desde la fila del primer administrador activo. Se conserva el blob
-- cifrado tal cual; la capa de aplicación se encarga de descifrarlo.
insert into public.admin_ocr_settings (
  id,
  ai_provider,
  ocr_api_keys,
  ocr_endpoints,
  ocr_models,
  ocr_thresholds,
  ocr_confidence_min,
  ai_routing_rules,
  ai_auto_assign_enabled,
  updated_by
)
select
  'global',
  us.ai_provider,
  coalesce(nullif(us.ocr_api_keys, '{}'::jsonb), '{}'::jsonb),
  coalesce(nullif(us.provider_config->'endpoints', 'null'::jsonb), nullif(us.data->'ocrEndpoints', 'null'::jsonb), '{}'::jsonb),
  coalesce(nullif(us.provider_config->'models', 'null'::jsonb), nullif(us.data->'ocrModels', 'null'::jsonb), '{}'::jsonb),
  coalesce(nullif(us.provider_config->'thresholds', 'null'::jsonb), nullif(us.data->'ocrThresholds', 'null'::jsonb), '{}'::jsonb),
  coalesce(us.ocr_confidence_min, 0.8),
  coalesce(nullif(us.data->'aiRoutingRules', 'null'::jsonb), '{}'::jsonb),
  coalesce(
    case when us.data->>'aiAutoAssignEnabled' in ('true', 'false')
      then (us.data->>'aiAutoAssignEnabled')::boolean end,
    us.ai_auto_assign_enabled,
    true
  ),
  us.user_id
from public.user_settings us
join public.profiles p on p.id = us.user_id
where lower(coalesce(p.role, '')) = 'admin'
order by us.created_at asc
limit 1
on conflict (id) do nothing;

-- Deja de usar user_settings como fuente de OCR: sin credenciales ni proveedor
-- por usuario. Las preferencias no-OCR (moneda, capital, niveles, etc.) siguen
-- siendo privadas y por usuario.
update public.user_settings us
set
  ai_provider = 'ocrspace',
  ocr_api_keys = '{}'::jsonb,
  provider_config = '{}'::jsonb,
  ai_routing_rules = '{}'::jsonb,
  ai_auto_assign_enabled = true,
  ocr_confidence_min = 0.8,
  data = us.data
    - 'ocrApiKeys'
    - 'aiApiKey'
    - 'ocrSpaceApiKey'
    - 'ocrEndpoints'
    - 'ocrModels'
    - 'ocrThresholds'
    - 'ocrConfidenceMin'
    - 'providerConfig'
    - 'aiRoutingRules'
    - 'aiAutoAssignEnabled'
where us.ocr_api_keys <> '{}'::jsonb
   or us.ai_provider <> 'ocrspace'
   or us.provider_config <> '{}'::jsonb
   or (us.data ? 'ocrApiKeys');
