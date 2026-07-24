import { query, transaction } from './index.js';

export async function advertisingDashboard() {
  await expireAdvertisingPlayout();
  const [campaigns, creatives, schedules, active, recent, media, stats] = await Promise.all([
    query(`select * from advertising_campaigns where status<>'archived' order by created_at desc`),
    query(
      `select c.*,p.name campaign_name,m.filename,m.mime_type
       from advertising_creatives c
       join advertising_campaigns p on p.id=c.campaign_id
       left join media_assets m on m.id=c.media_id
       order by c.created_at desc`,
    ),
    query(
      `select s.*,c.name campaign_name,a.name creative_name
       from advertising_schedules s
       join advertising_campaigns c on c.id=s.campaign_id
       left join advertising_creatives a on a.id=s.creative_id
       order by s.enabled desc,s.next_run_at`,
    ),
    getActiveAdvertisingPlayout(),
    query(
      `select p.*,c.name campaign_name,a.name creative_name,a.creative_type
       from advertising_playouts p
       join advertising_campaigns c on c.id=p.campaign_id
       join advertising_creatives a on a.id=p.creative_id
       order by p.started_at desc limit 40`,
    ),
    query(
      `select id,filename,mime_type,duration_seconds,resolution,created_at,usage
       from media_assets
       where deleted_at is null and storage_path is not null
         and (mime_type like 'image/%' or mime_type like 'video/%')
       order by created_at desc limit 500`,
    ),
    query(
      `select
        count(*) filter(where started_at>=date_trunc('day',now()))::int today,
        count(*) filter(where started_at>=now()-interval '1 hour')::int last_hour,
        count(*) filter(where status='on_air')::int on_air
       from advertising_playouts`,
    ),
  ]);
  return {
    campaigns: campaigns.rows,
    creatives: creatives.rows,
    schedules: schedules.rows,
    active,
    recent: recent.rows,
    media: media.rows,
    stats: stats.rows[0],
  };
}

export async function createAdvertisingCampaign(input: Record<string, any>, userId?: string | null) {
  return (
    await query(
      `insert into advertising_campaigns(
         name,advertiser,status,starts_at,ends_at,daily_start,daily_end,weekdays,timezone,
         priority,max_per_hour,minimum_gap_seconds,notes,created_by
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
      [
        input.name,
        input.advertiser,
        input.status,
        input.startsAt,
        input.endsAt,
        input.dailyStart,
        input.dailyEnd,
        input.weekdays,
        input.timezone,
        input.priority,
        input.maxPerHour,
        input.minimumGapSeconds,
        input.notes,
        userId ?? null,
      ],
    )
  ).rows[0];
}

export async function updateAdvertisingCampaign(id: string, input: Record<string, any>) {
  return (
    await query(
      `update advertising_campaigns set
         name=$2,advertiser=$3,status=$4,starts_at=$5,ends_at=$6,daily_start=$7,daily_end=$8,
         weekdays=$9,timezone=$10,priority=$11,max_per_hour=$12,minimum_gap_seconds=$13,
         notes=$14,updated_at=now()
       where id=$1 returning *`,
      [
        id,
        input.name,
        input.advertiser,
        input.status,
        input.startsAt,
        input.endsAt,
        input.dailyStart,
        input.dailyEnd,
        input.weekdays,
        input.timezone,
        input.priority,
        input.maxPerHour,
        input.minimumGapSeconds,
        input.notes,
      ],
    )
  ).rows[0] ?? null;
}

export async function archiveAdvertisingCampaign(id: string) {
  await query(`update advertising_schedules set enabled=false,updated_at=now() where campaign_id=$1`, [id]);
  return (
    await query(
      `update advertising_campaigns set status='archived',updated_at=now() where id=$1 returning *`,
      [id],
    )
  ).rows[0] ?? null;
}

export async function createAdvertisingCreative(input: Record<string, any>) {
  return (
    await query(
      `insert into advertising_creatives(
         campaign_id,name,creative_type,headline,body,call_to_action,destination_url,media_id,
         placement,style,transition,duration_seconds,weight,active
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
      [
        input.campaignId,
        input.name,
        input.creativeType,
        input.headline,
        input.body,
        input.callToAction,
        input.destinationUrl,
        input.mediaId,
        input.placement,
        input.style,
        input.transition,
        input.durationSeconds,
        input.weight,
        input.active,
      ],
    )
  ).rows[0];
}

export async function updateAdvertisingCreative(id: string, input: Record<string, any>) {
  return (
    await query(
      `update advertising_creatives set
         campaign_id=$2,name=$3,creative_type=$4,headline=$5,body=$6,call_to_action=$7,
         destination_url=$8,media_id=$9,placement=$10,style=$11,transition=$12,
         duration_seconds=$13,weight=$14,active=$15,updated_at=now()
       where id=$1 returning *`,
      [
        id,
        input.campaignId,
        input.name,
        input.creativeType,
        input.headline,
        input.body,
        input.callToAction,
        input.destinationUrl,
        input.mediaId,
        input.placement,
        input.style,
        input.transition,
        input.durationSeconds,
        input.weight,
        input.active,
      ],
    )
  ).rows[0] ?? null;
}

export async function deleteAdvertisingCreative(id: string) {
  return (await query(`delete from advertising_creatives where id=$1 returning *`, [id])).rows[0] ?? null;
}

export async function createAdvertisingSchedule(input: Record<string, any>) {
  return (
    await query(
      `insert into advertising_schedules(
         campaign_id,creative_id,name,schedule_type,starts_at,ends_at,weekdays,daily_start,
         daily_end,interval_minutes,next_run_at,enabled
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
      [
        input.campaignId,
        input.creativeId,
        input.name,
        input.scheduleType,
        input.startsAt,
        input.endsAt,
        input.weekdays,
        input.dailyStart,
        input.dailyEnd,
        input.intervalMinutes,
        input.nextRunAt,
        input.enabled,
      ],
    )
  ).rows[0];
}

export async function updateAdvertisingSchedule(id: string, input: Record<string, any>) {
  return (
    await query(
      `update advertising_schedules set
         campaign_id=$2,creative_id=$3,name=$4,schedule_type=$5,starts_at=$6,ends_at=$7,
         weekdays=$8,daily_start=$9,daily_end=$10,interval_minutes=$11,next_run_at=$12,
         enabled=$13,updated_at=now()
       where id=$1 returning *`,
      [
        id,
        input.campaignId,
        input.creativeId,
        input.name,
        input.scheduleType,
        input.startsAt,
        input.endsAt,
        input.weekdays,
        input.dailyStart,
        input.dailyEnd,
        input.intervalMinutes,
        input.nextRunAt,
        input.enabled,
      ],
    )
  ).rows[0] ?? null;
}

export async function deleteAdvertisingSchedule(id: string) {
  return (await query(`delete from advertising_schedules where id=$1 returning *`, [id])).rows[0] ?? null;
}

export async function expireAdvertisingPlayout() {
  await query(
    `update advertising_playouts set status='completed',ended_at=coalesce(ended_at,expires_at)
     where status='on_air' and expires_at<=now()`,
  );
}

export async function getActiveAdvertisingPlayout() {
  await expireAdvertisingPlayout();
  return (
    await query(
      `select p.*,c.name campaign_name,c.advertiser,a.name creative_name,a.creative_type,
              a.headline,a.body,a.call_to_action,a.destination_url,a.media_id,a.placement,
              a.style,a.transition,a.duration_seconds,m.filename,m.mime_type
       from advertising_playouts p
       join advertising_campaigns c on c.id=p.campaign_id
       join advertising_creatives a on a.id=p.creative_id
       left join media_assets m on m.id=a.media_id
       where p.status='on_air' and p.expires_at>now()
       order by p.started_at desc limit 1`,
    )
  ).rows[0] ?? null;
}

export async function startAdvertisingPlayout(input: {
  creativeId: string;
  scheduleId?: string | null;
  triggerType: 'manual' | 'schedule';
  createdBy?: string | null;
}) {
  return transaction(async (client) => {
    await client.query(
      `update advertising_playouts set status='completed',ended_at=now() where status='on_air'`,
    );
    const selected = (
      await client.query(
        `select a.*,c.status campaign_status
         from advertising_creatives a join advertising_campaigns c on c.id=a.campaign_id
         where a.id=$1 and a.active=true and c.status='active' for update`,
        [input.creativeId],
      )
    ).rows[0];
    if (!selected) throw new Error('advertising-creative-not-ready');
    const playout = (
      await client.query(
        `insert into advertising_playouts(
           campaign_id,creative_id,schedule_id,status,trigger_type,expires_at,created_by
         ) values($1,$2,$3,'on_air',$4,now()+($5::int||' seconds')::interval,$6) returning *`,
        [
          selected.campaign_id,
          selected.id,
          input.scheduleId ?? null,
          input.triggerType,
          selected.duration_seconds,
          input.createdBy ?? null,
        ],
      )
    ).rows[0];
    await client.query(
      `update advertising_creatives set play_count=play_count+1,last_played_at=now(),updated_at=now() where id=$1`,
      [selected.id],
    );
    return playout;
  });
}

export async function endAdvertisingPlayout(id: string) {
  return (
    await query(
      `update advertising_playouts set status='cancelled',ended_at=now()
       where id=$1 and status='on_air' returning *`,
      [id],
    )
  ).rows[0] ?? null;
}

export async function claimDueAdvertisingPlayout() {
  await expireAdvertisingPlayout();
  if (await getActiveAdvertisingPlayout()) return null;
  const due = (
    await query(
      `select s.id schedule_id,
              coalesce(s.creative_id,(
                select a2.id from advertising_creatives a2
                where a2.campaign_id=s.campaign_id and a2.active=true
                order by
                  (extract(epoch from (now()-coalesce(a2.last_played_at,'epoch'::timestamptz))) * a2.weight) desc,
                  random()
                limit 1
              )) creative_id
       from advertising_schedules s
       join advertising_campaigns c on c.id=s.campaign_id
       where s.enabled=true and s.next_run_at<=now()
         and c.status='active'
         and (c.starts_at is null or c.starts_at<=now()) and (c.ends_at is null or c.ends_at>now())
         and (s.starts_at is null or s.starts_at<=now()) and (s.ends_at is null or s.ends_at>now())
         and extract(isodow from now() at time zone c.timezone)::int=any(c.weekdays)
         and extract(isodow from now() at time zone c.timezone)::int=any(s.weekdays)
         and (c.daily_start is null or (now() at time zone c.timezone)::time>=c.daily_start)
         and (c.daily_end is null or (now() at time zone c.timezone)::time<=c.daily_end)
         and (s.daily_start is null or (now() at time zone c.timezone)::time>=s.daily_start)
         and (s.daily_end is null or (now() at time zone c.timezone)::time<=s.daily_end)
         and (select count(*) from advertising_playouts p where p.campaign_id=c.id and p.started_at>=now()-interval '1 hour')<c.max_per_hour
         and not exists(
           select 1 from advertising_playouts p
           where p.campaign_id=c.id and p.started_at>now()-(c.minimum_gap_seconds||' seconds')::interval
         )
       order by c.priority desc,s.next_run_at
       limit 1`,
    )
  ).rows[0];
  if (!due?.creative_id) return null;
  try {
    const playout = await startAdvertisingPlayout({
      creativeId: due.creative_id,
      scheduleId: due.schedule_id,
      triggerType: 'schedule',
    });
    await query(
      `update advertising_schedules set
         next_run_at=case
           when schedule_type='fixed' then coalesce(ends_at,now()+interval '100 years')
           else now()+(interval_minutes||' minutes')::interval
         end,
         enabled=case when schedule_type='fixed' then false else enabled end,
         updated_at=now()
       where id=$1`,
      [due.schedule_id],
    );
    return playout;
  } catch (error) {
    if (error instanceof Error && /duplicate key|idx_advertising_single_on_air/.test(error.message)) return null;
    throw error;
  }
}

export async function getAdvertisingPlayoutMedia(playoutId: string) {
  return (
    await query(
      `select m.* from advertising_playouts p
       join advertising_creatives a on a.id=p.creative_id
       join media_assets m on m.id=a.media_id
       where p.id=$1`,
      [playoutId],
    )
  ).rows[0] ?? null;
}
