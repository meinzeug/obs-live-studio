create table if not exists advertising_material_projects(
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references advertising_campaigns(id) on delete set null,
  name text not null,
  material_kind text not null default 'flyer',
  format_preset text not null default 'a5',
  orientation text not null default 'portrait',
  visual_style text not null default 'broadcast',
  headline text not null default '',
  body text not null default '',
  call_to_action text not null default '',
  website text not null default '',
  advertiser text not null default '',
  primary_color text not null default '#07111f',
  accent_color text not null default '#22d3ee',
  text_color text not null default '#f8fafc',
  background_mode text not null default 'gradient',
  design jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint advertising_material_kind_valid check(material_kind=any('{flyer,poster,social,tshirt,card}'::text[])),
  constraint advertising_material_format_valid check(format_preset=any('{a6,a5,a4,a3,square,story,tshirt}'::text[])),
  constraint advertising_material_orientation_valid check(orientation=any('{portrait,landscape}'::text[])),
  constraint advertising_material_style_valid check(visual_style=any('{broadcast,editorial,bold,minimal,community}'::text[])),
  constraint advertising_material_background_valid check(background_mode=any('{gradient,dark,light,accent}'::text[])),
  constraint advertising_material_status_valid check(status=any('{draft,ready,archived}'::text[])),
  constraint advertising_material_primary_color_valid check(primary_color ~ '^#[0-9a-fA-F]{6}$'),
  constraint advertising_material_accent_color_valid check(accent_color ~ '^#[0-9a-fA-F]{6}$'),
  constraint advertising_material_text_color_valid check(text_color ~ '^#[0-9a-fA-F]{6}$')
);

create index if not exists idx_advertising_material_projects_updated
  on advertising_material_projects(status,updated_at desc);

create table if not exists advertising_material_exports(
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references advertising_material_projects(id) on delete cascade,
  export_type text not null,
  format_preset text not null,
  width_px integer not null,
  height_px integer not null,
  dpi integer not null default 300,
  storage_path text not null,
  mime_type text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now(),
  constraint advertising_material_export_type_valid check(export_type=any('{png,pdf,jpeg}'::text[]))
);

create index if not exists idx_advertising_material_exports_project
  on advertising_material_exports(project_id,created_at desc);
