alter table advertising_campaigns
  add column if not exists target_playouts integer not null default 0,
  add column if not exists target_daily_playouts integer not null default 0;

do $$
begin
  if not exists(
    select 1 from pg_constraint where conname='advertising_campaign_target_playouts_valid'
  ) then
    alter table advertising_campaigns
      add constraint advertising_campaign_target_playouts_valid
      check(target_playouts between 0 and 1000000);
  end if;
  if not exists(
    select 1 from pg_constraint where conname='advertising_campaign_target_daily_valid'
  ) then
    alter table advertising_campaigns
      add constraint advertising_campaign_target_daily_valid
      check(target_daily_playouts between 0 and 10000);
  end if;
end $$;

alter table advertising_creatives
  add column if not exists deleted_at timestamptz;

alter table advertising_schedules
  add column if not exists deleted_at timestamptz;

create index if not exists idx_advertising_creatives_campaign_available
  on advertising_creatives(campaign_id,active,weight desc)
  where deleted_at is null;

create index if not exists idx_advertising_schedules_campaign_available
  on advertising_schedules(campaign_id,enabled,next_run_at)
  where deleted_at is null;

create index if not exists idx_advertising_playouts_campaign_started
  on advertising_playouts(campaign_id,started_at desc);

create index if not exists idx_advertising_playouts_creative_started
  on advertising_playouts(creative_id,started_at desc);
