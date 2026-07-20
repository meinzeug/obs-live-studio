create table if not exists youtube_video_categories(
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  description text,
  color text not null default '#ef4444',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists youtube_videos(
  id uuid primary key default gen_random_uuid(),
  category_id uuid references youtube_video_categories(id) on delete set null,
  title text not null,
  url text not null,
  video_id text not null,
  description text,
  duration_seconds int not null default 900,
  enabled boolean not null default true,
  last_scheduled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists idx_youtube_videos_video_id_active
  on youtube_videos(video_id)
  where deleted_at is null;

create index if not exists idx_youtube_videos_category_active
  on youtube_videos(category_id, enabled, deleted_at);

create index if not exists idx_broadcast_items_youtube_video
  on broadcast_items((rules->>'youtubeVideoId'))
  where rules->>'kind' = 'youtube-video';

insert into youtube_video_categories(name, description, color, sort_order)
values
  ('Dokumentationen', 'Längere Hintergrund- und Dokumentationsvideos.', '#ef4444', 10),
  ('Interviews', 'Gespräche, O-Töne und längere Interviewformate.', '#f59e0b', 20),
  ('Hintergrund', 'Erklärvideos, Analysen und vertiefende Beiträge.', '#3b82f6', 30),
  ('Kultur und Wissen', 'Wissens-, Kultur- und Gesellschaftsformate.', '#10b981', 40),
  ('Reaction', 'Videos, auf die in Live- oder Reaction-Formaten reagiert wird.', '#8b5cf6', 50)
on conflict(name) do nothing;
