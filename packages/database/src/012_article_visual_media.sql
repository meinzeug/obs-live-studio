alter table media_assets add column if not exists media_kind text;
alter table media_assets add column if not exists provider text;
alter table media_assets add column if not exists provider_asset_id text;
alter table media_assets add column if not exists license_url text;
alter table media_assets add column if not exists preview_url text;

create table if not exists article_media_candidates(
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references articles(id) on delete cascade,
  media_id uuid references media_assets(id) on delete set null,
  kind text not null check(kind in ('video','image','graphic','statistic','reference')),
  provider text not null,
  provider_asset_id text not null,
  title text not null,
  search_query text not null,
  source_url text not null,
  download_url text,
  preview_url text,
  embed_url text,
  mime_type text,
  duration_seconds numeric,
  width int,
  height int,
  author text,
  license_name text,
  license_url text,
  attribution text,
  relevance_score numeric not null default 0,
  rights_status text not null default 'review' check(rights_status in ('approved','review','restricted','unknown')),
  status text not null default 'candidate' check(status in ('candidate','importing','approved','rejected','reference','failed')),
  metadata jsonb not null default '{}',
  error text,
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_article_media_candidate_provider
  on article_media_candidates(article_id,provider,provider_asset_id,kind);
create index if not exists idx_article_media_candidate_readiness
  on article_media_candidates(article_id,status,kind,relevance_score desc);
create unique index if not exists idx_media_assets_provider_asset
  on media_assets(provider,provider_asset_id)
  where provider is not null and provider_asset_id is not null;
create unique index if not exists idx_article_media_link_purpose
  on media_links(article_id,purpose)
  where article_id is not null and purpose in ('article-video','article-graphic');

create or replace function require_article_video_for_broadcast()
returns trigger
language plpgsql
as $$
begin
  if not exists(
    select 1
    from media_links ml
    join media_assets ma on ma.id=ml.media_id
    where ml.article_id=new.article_id
      and ml.purpose='article-video'
      and ma.storage_path is not null
      and ma.mime_type like 'video/%'
  ) then
    raise exception 'Kein freigegebenes lokales Video für Beitrag % vorhanden', new.article_id;
  end if;
  return new;
end;
$$;

drop trigger if exists broadcast_items_require_article_video on broadcast_items;
create trigger broadcast_items_require_article_video
before insert or update of article_id on broadcast_items
for each row execute function require_article_video_for_broadcast();

update broadcast_items bi
set status='error',error='Kein freigegebenes Video für diesen Beitrag vorhanden'
where bi.status='planned'
  and not exists(
    select 1
    from media_links ml
    join media_assets ma on ma.id=ml.media_id
    where ml.article_id=bi.article_id
      and ml.purpose='article-video'
      and ma.storage_path is not null
      and ma.mime_type like 'video/%'
  );
