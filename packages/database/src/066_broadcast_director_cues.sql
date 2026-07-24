create table if not exists broadcast_director_cues(
  id uuid primary key default gen_random_uuid(),
  cue_type text not null check(cue_type in ('text','banner','image','video')),
  title text not null default '',
  message text not null default '',
  media_id uuid references media_assets(id) on delete set null,
  position text not null default 'lower-third' check(position in ('fullscreen','top','lower-third','bottom-right')),
  style text not null default 'studio' check(style in ('studio','breaking','info','minimal')),
  transition text not null default 'fade' check(transition in ('fade','slide','zoom','cut')),
  duration_seconds integer not null default 10 check(duration_seconds between 2 and 300),
  status text not null default 'on_air' check(status in ('on_air','completed','cancelled','failed')),
  created_by uuid references users(id) on delete set null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_broadcast_director_cues_status_expires
  on broadcast_director_cues(status,expires_at desc);

create index if not exists idx_broadcast_director_cues_created
  on broadcast_director_cues(created_at desc);
