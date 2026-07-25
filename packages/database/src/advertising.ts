import { query, transaction } from './index.js';

export async function advertisingDashboard() {
  await expireAdvertisingPlayout();
  const [campaignsResult, creatives, schedules, active, recent, media, stats, daily] = await Promise.all([
    query(
      `select c.*,
              (select count(*)::int from advertising_creatives a
               where a.campaign_id=c.id and a.deleted_at is null) creative_count,
              (select count(*)::int from advertising_creatives a
               where a.campaign_id=c.id and a.deleted_at is null and a.active=true) active_creative_count,
              (select count(*)::int from advertising_schedules s
               where s.campaign_id=c.id and s.deleted_at is null) schedule_count,
              (select count(*)::int from advertising_schedules s
               where s.campaign_id=c.id and s.deleted_at is null and s.enabled=true) enabled_schedule_count,
              (select count(*)::int from advertising_playouts p where p.campaign_id=c.id) playout_count,
              (select count(*)::int from advertising_playouts p
               where p.campaign_id=c.id and p.started_at>=date_trunc('day',now())) playouts_today,
              (select count(*)::int from advertising_playouts p
               where p.campaign_id=c.id and p.started_at>=now()-interval '7 days') playouts_7d,
              (select count(*)::int from advertising_playouts p
               where p.campaign_id=c.id and p.started_at>=now()-interval '30 days') playouts_30d,
              (select count(*)::int from advertising_playouts p
               where p.campaign_id=c.id and p.status='completed') completed_playouts,
              (select count(*)::int from advertising_playouts p
               where p.campaign_id=c.id and p.status='cancelled') cancelled_playouts,
              (select count(*)::int from advertising_playouts p
               where p.campaign_id=c.id and p.status='failed') failed_playouts,
              (select coalesce(round(sum(extract(epoch from
                (coalesce(p.ended_at,least(now(),p.expires_at))-p.started_at)))::numeric),0)::int
               from advertising_playouts p where p.campaign_id=c.id) airtime_seconds,
              (select max(p.started_at) from advertising_playouts p where p.campaign_id=c.id) last_playout_at
       from advertising_campaigns c
       order by c.status='active' desc,c.priority desc,c.created_at desc`,
    ),
    query(
      `select c.*,p.name campaign_name,m.filename,m.mime_type,
              (select count(*)::int from advertising_playouts ap where ap.creative_id=c.id) playout_count,
              (select count(*)::int from advertising_playouts ap
               where ap.creative_id=c.id and ap.started_at>=date_trunc('day',now())) playouts_today,
              (select count(*)::int from advertising_playouts ap
               where ap.creative_id=c.id and ap.started_at>=now()-interval '7 days') playouts_7d,
              (select count(*)::int from advertising_playouts ap
               where ap.creative_id=c.id and ap.status='completed') completed_playouts,
              (select max(ap.started_at) from advertising_playouts ap where ap.creative_id=c.id) last_playout_at
       from advertising_creatives c
       join advertising_campaigns p on p.id=c.campaign_id
       left join media_assets m on m.id=c.media_id
       where c.deleted_at is null and p.status<>'archived'
       order by c.active desc,c.created_at desc`,
    ),
    query(
      `select s.*,c.name campaign_name,c.status campaign_status,a.name creative_name,
              (select count(*)::int from advertising_playouts p where p.schedule_id=s.id) playout_count,
              (select max(p.started_at) from advertising_playouts p where p.schedule_id=s.id) last_playout_at,
              case
                when s.enabled=false then 'paused'
                when c.status<>'active' then 'campaign-inactive'
                when s.starts_at is not null and s.starts_at>now() then 'not-started'
                when s.ends_at is not null and s.ends_at<=now() then 'expired'
                when s.next_run_at>now() then 'scheduled'
                when not exists(
                  select 1 from advertising_creatives ready
                  left join media_assets rm on rm.id=ready.media_id and rm.deleted_at is null
                  where ready.campaign_id=s.campaign_id and ready.deleted_at is null and ready.active=true
                    and (s.creative_id is null or ready.id=s.creative_id)
                    and (
                      (ready.creative_type in ('text','banner') and (ready.headline<>'' or ready.body<>''))
                      or (ready.creative_type in ('image','video') and rm.storage_path is not null)
                    )
                ) then 'missing-creative'
                when (select count(*) from advertising_playouts p
                      where p.campaign_id=c.id and p.started_at>=now()-interval '1 hour')>=c.max_per_hour
                  then 'frequency-cap'
                when exists(
                  select 1 from advertising_playouts p
                  where p.campaign_id=c.id
                    and p.started_at>now()-(c.minimum_gap_seconds||' seconds')::interval
                ) then 'minimum-gap'
                else 'ready'
              end delivery_state
       from advertising_schedules s
       join advertising_campaigns c on c.id=s.campaign_id
       left join advertising_creatives a on a.id=s.creative_id
       where s.deleted_at is null and c.status<>'archived'
       order by s.enabled desc,s.next_run_at`,
    ),
    getActiveAdvertisingPlayout(),
    query(
      `select p.*,c.name campaign_name,a.name creative_name,a.creative_type
       from advertising_playouts p
       join advertising_campaigns c on c.id=p.campaign_id
       join advertising_creatives a on a.id=p.creative_id
       order by p.started_at desc limit 120`,
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
        count(*) filter(where started_at>=now()-interval '7 days')::int last_7d,
        count(*) filter(where started_at>=now()-interval '30 days')::int last_30d,
        count(*) filter(where status='on_air')::int on_air
        ,count(*) filter(where status='completed' and started_at>=now()-interval '30 days')::int completed_30d
        ,count(*) filter(where status='cancelled' and started_at>=now()-interval '30 days')::int cancelled_30d
        ,count(*) filter(where status='failed' and started_at>=now()-interval '30 days')::int failed_30d
        ,coalesce(round(avg(extract(epoch from
          (coalesce(ended_at,least(now(),expires_at))-started_at)))
          filter(where started_at>=now()-interval '30 days')::numeric,1),0)::float avg_duration_seconds
        ,coalesce(round(sum(extract(epoch from
          (coalesce(ended_at,least(now(),expires_at))-started_at)))
          filter(where started_at>=now()-interval '30 days')::numeric),0)::int airtime_seconds_30d
       from advertising_playouts`,
    ),
    query(
      `with days as (
         select generate_series(
           date_trunc('day',now())-interval '13 days',
           date_trunc('day',now()),
           interval '1 day'
         ) as bucket_start
       )
       select bucket_start::date::text date,
              count(p.id)::int total,
              count(p.id) filter(where p.trigger_type='schedule')::int scheduled,
              count(p.id) filter(where p.trigger_type='manual')::int manual,
              count(p.id) filter(where p.status='completed')::int completed
       from days
       left join advertising_playouts p
         on p.started_at>=days.bucket_start and p.started_at<days.bucket_start+interval '1 day'
       group by bucket_start
       order by bucket_start`,
    ),
  ]);
  const campaigns = campaignsResult.rows.filter((campaign) => campaign.status !== 'archived');
  const archivedCampaigns = campaignsResult.rows.filter((campaign) => campaign.status === 'archived');
  const scheduleRows = schedules.rows;
  return {
    campaigns,
    archivedCampaigns,
    creatives: creatives.rows,
    schedules: scheduleRows,
    active,
    recent: recent.rows,
    media: media.rows,
    stats: stats.rows[0],
    analytics: {
      daily: daily.rows,
      dueSchedules: scheduleRows.filter(
        (schedule) => schedule.enabled && new Date(schedule.next_run_at).getTime() <= Date.now(),
      ).length,
      readySchedules: scheduleRows.filter((schedule) => schedule.delivery_state === 'ready').length,
      blockedSchedules: scheduleRows.filter((schedule) =>
        ['missing-creative', 'campaign-inactive', 'expired'].includes(schedule.delivery_state),
      ).length,
    },
    serverTime: new Date().toISOString(),
  };
}

export async function createAdvertisingCampaign(input: Record<string, any>, userId?: string | null) {
  return (
    await query(
      `insert into advertising_campaigns(
         name,advertiser,status,starts_at,ends_at,daily_start,daily_end,weekdays,timezone,
         priority,max_per_hour,minimum_gap_seconds,target_playouts,target_daily_playouts,notes,created_by
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning *`,
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
        input.targetPlayouts,
        input.targetDailyPlayouts,
        input.notes,
        userId ?? null,
      ],
    )
  ).rows[0];
}

export async function updateAdvertisingCampaign(id: string, input: Record<string, any>) {
  return (
    (
      await query(
        `update advertising_campaigns set
         name=$2,advertiser=$3,status=$4,starts_at=$5,ends_at=$6,daily_start=$7,daily_end=$8,
         weekdays=$9,timezone=$10,priority=$11,max_per_hour=$12,minimum_gap_seconds=$13,
         target_playouts=$14,target_daily_playouts=$15,notes=$16,updated_at=now()
       where id=$1 and status<>'archived' returning *`,
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
          input.targetPlayouts,
          input.targetDailyPlayouts,
          input.notes,
        ],
      )
    ).rows[0] ?? null
  );
}

export async function archiveAdvertisingCampaign(id: string) {
  await query(
    `update advertising_playouts set status='cancelled',ended_at=now()
     where campaign_id=$1 and status='on_air'`,
    [id],
  );
  await query(
    `update advertising_schedules set enabled=false,updated_at=now()
     where campaign_id=$1 and deleted_at is null`,
    [id],
  );
  return (
    (await query(`update advertising_campaigns set status='archived',updated_at=now() where id=$1 returning *`, [id]))
      .rows[0] ?? null
  );
}

export async function restoreAdvertisingCampaign(id: string) {
  return (
    (
      await query(
        `update advertising_campaigns set status='paused',updated_at=now()
       where id=$1 and status='archived' returning *`,
        [id],
      )
    ).rows[0] ?? null
  );
}

export async function setAdvertisingCampaignStatus(id: string, status: 'draft' | 'active' | 'paused' | 'completed') {
  if (status !== 'active') {
    await query(
      `update advertising_playouts set status='cancelled',ended_at=now()
       where campaign_id=$1 and status='on_air'`,
      [id],
    );
  }
  return (
    (
      await query(
        `update advertising_campaigns set status=$2,updated_at=now()
       where id=$1 and status<>'archived' returning *`,
        [id, status],
      )
    ).rows[0] ?? null
  );
}

export async function duplicateAdvertisingCampaign(id: string, userId?: string | null) {
  return transaction(async (client) => {
    const source = (
      await client.query(`select * from advertising_campaigns where id=$1 and status<>'archived' for share`, [id])
    ).rows[0];
    if (!source) return null;
    const duplicated = (
      await client.query(
        `insert into advertising_campaigns(
           name,advertiser,status,starts_at,ends_at,daily_start,daily_end,weekdays,timezone,
           priority,max_per_hour,minimum_gap_seconds,target_playouts,target_daily_playouts,notes,created_by
         ) values($1,$2,'draft',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *`,
        [
          `${source.name} · Kopie`,
          source.advertiser,
          source.starts_at,
          source.ends_at,
          source.daily_start,
          source.daily_end,
          source.weekdays,
          source.timezone,
          source.priority,
          source.max_per_hour,
          source.minimum_gap_seconds,
          source.target_playouts,
          source.target_daily_playouts,
          source.notes,
          userId ?? null,
        ],
      )
    ).rows[0];
    const creativeMap = new Map<string, string>();
    const sourceCreatives = (
      await client.query(
        `select * from advertising_creatives
         where campaign_id=$1 and deleted_at is null order by created_at`,
        [id],
      )
    ).rows;
    for (const creative of sourceCreatives) {
      const copied = (
        await client.query(
          `insert into advertising_creatives(
             campaign_id,name,creative_type,headline,body,call_to_action,destination_url,media_id,
             placement,style,transition,duration_seconds,weight,active
           ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,false) returning id`,
          [
            duplicated.id,
            creative.name,
            creative.creative_type,
            creative.headline,
            creative.body,
            creative.call_to_action,
            creative.destination_url,
            creative.media_id,
            creative.placement,
            creative.style,
            creative.transition,
            creative.duration_seconds,
            creative.weight,
          ],
        )
      ).rows[0];
      creativeMap.set(creative.id, copied.id);
    }
    const sourceSchedules = (
      await client.query(
        `select * from advertising_schedules
         where campaign_id=$1 and deleted_at is null order by created_at`,
        [id],
      )
    ).rows;
    for (const schedule of sourceSchedules) {
      await client.query(
        `insert into advertising_schedules(
           campaign_id,creative_id,name,schedule_type,starts_at,ends_at,weekdays,daily_start,
           daily_end,interval_minutes,next_run_at,enabled
         ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false)`,
        [
          duplicated.id,
          schedule.creative_id ? (creativeMap.get(schedule.creative_id) ?? null) : null,
          schedule.name,
          schedule.schedule_type,
          schedule.starts_at,
          schedule.ends_at,
          schedule.weekdays,
          schedule.daily_start,
          schedule.daily_end,
          schedule.interval_minutes,
          schedule.next_run_at,
        ],
      );
    }
    return {
      ...duplicated,
      copiedCreatives: sourceCreatives.length,
      copiedSchedules: sourceSchedules.length,
    };
  });
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
    (
      await query(
        `update advertising_creatives set
         campaign_id=$2,name=$3,creative_type=$4,headline=$5,body=$6,call_to_action=$7,
         destination_url=$8,media_id=$9,placement=$10,style=$11,transition=$12,
         duration_seconds=$13,weight=$14,active=$15,updated_at=now()
       where id=$1 and deleted_at is null returning *`,
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
    ).rows[0] ?? null
  );
}

export async function deleteAdvertisingCreative(id: string) {
  return (
    (
      await query(
        `update advertising_creatives set active=false,deleted_at=now(),updated_at=now()
       where id=$1 and deleted_at is null returning *`,
        [id],
      )
    ).rows[0] ?? null
  );
}

export async function setAdvertisingCreativeActive(id: string, active: boolean) {
  return (
    (
      await query(
        `update advertising_creatives set active=$2,updated_at=now()
       where id=$1 and deleted_at is null returning *`,
        [id, active],
      )
    ).rows[0] ?? null
  );
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
    (
      await query(
        `update advertising_schedules set
         campaign_id=$2,creative_id=$3,name=$4,schedule_type=$5,starts_at=$6,ends_at=$7,
         weekdays=$8,daily_start=$9,daily_end=$10,interval_minutes=$11,next_run_at=$12,
         enabled=$13,updated_at=now()
       where id=$1 and deleted_at is null returning *`,
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
    ).rows[0] ?? null
  );
}

export async function deleteAdvertisingSchedule(id: string) {
  return (
    (
      await query(
        `update advertising_schedules set enabled=false,deleted_at=now(),updated_at=now()
       where id=$1 and deleted_at is null returning *`,
        [id],
      )
    ).rows[0] ?? null
  );
}

export async function setAdvertisingScheduleEnabled(id: string, enabled: boolean) {
  return (
    (
      await query(
        `update advertising_schedules set enabled=$2,
         next_run_at=case when $2=true and next_run_at<now() then now() else next_run_at end,
         updated_at=now()
       where id=$1 and deleted_at is null returning *`,
        [id, enabled],
      )
    ).rows[0] ?? null
  );
}

export async function expireAdvertisingPlayout() {
  return (
    await query(
      `update advertising_playouts set status='completed',ended_at=coalesce(ended_at,expires_at)
     where status='on_air' and expires_at<=now()
     returning *`,
    )
  ).rows;
}

export async function getActiveAdvertisingPlayout() {
  await expireAdvertisingPlayout();
  return (
    (
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
    ).rows[0] ?? null
  );
}

export async function startAdvertisingPlayout(input: {
  creativeId: string;
  scheduleId?: string | null;
  triggerType: 'manual' | 'schedule';
  createdBy?: string | null;
}) {
  return transaction(async (client) => {
    await client.query(`update advertising_playouts set status='completed',ended_at=now() where status='on_air'`);
    const selected = (
      await client.query(
        `select a.*,c.status campaign_status
         from advertising_creatives a
         join advertising_campaigns c on c.id=a.campaign_id
         left join media_assets m on m.id=a.media_id and m.deleted_at is null
         where a.id=$1 and a.active=true and a.deleted_at is null and c.status='active'
           and (c.starts_at is null or c.starts_at<=now())
           and (c.ends_at is null or c.ends_at>now())
           and extract(isodow from now() at time zone c.timezone)::int=any(c.weekdays)
           and (
             (c.daily_start is null and c.daily_end is null)
             or (c.daily_start is null and (now() at time zone c.timezone)::time<=c.daily_end)
             or (c.daily_end is null and (now() at time zone c.timezone)::time>=c.daily_start)
             or (
               c.daily_start<=c.daily_end
               and (now() at time zone c.timezone)::time between c.daily_start and c.daily_end
             )
             or (
               c.daily_start>c.daily_end
               and (
                 (now() at time zone c.timezone)::time>=c.daily_start
                 or (now() at time zone c.timezone)::time<=c.daily_end
               )
             )
           )
           and (
             (a.creative_type in ('text','banner') and (a.headline<>'' or a.body<>''))
             or (a.creative_type in ('image','video') and m.storage_path is not null)
           )
         for update of a,c`,
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
    (
      await query(
        `update advertising_playouts set status='cancelled',ended_at=now()
       where id=$1 and status='on_air' returning *`,
        [id],
      )
    ).rows[0] ?? null
  );
}

export async function claimDueAdvertisingPlayout(prepare?: () => Promise<void>) {
  await expireAdvertisingPlayout();
  if (await getActiveAdvertisingPlayout()) return null;
  const due = (
    await query(
      `select s.id schedule_id,
              coalesce(s.creative_id,(
                select a2.id from advertising_creatives a2
                left join media_assets m2 on m2.id=a2.media_id and m2.deleted_at is null
                where a2.campaign_id=s.campaign_id and a2.active=true and a2.deleted_at is null
                  and (
                    (a2.creative_type in ('text','banner') and (a2.headline<>'' or a2.body<>''))
                    or (a2.creative_type in ('image','video') and m2.storage_path is not null)
                  )
                order by
                  (extract(epoch from (now()-coalesce(a2.last_played_at,'epoch'::timestamptz))) * a2.weight) desc,
                  random()
                limit 1
              )) creative_id
       from advertising_schedules s
       join advertising_campaigns c on c.id=s.campaign_id
       where s.enabled=true and s.deleted_at is null and s.next_run_at<=now()
         and c.status='active'
         and (c.starts_at is null or c.starts_at<=now()) and (c.ends_at is null or c.ends_at>now())
         and (s.starts_at is null or s.starts_at<=now()) and (s.ends_at is null or s.ends_at>now())
         and extract(isodow from now() at time zone c.timezone)::int=any(c.weekdays)
         and extract(isodow from now() at time zone c.timezone)::int=any(s.weekdays)
         and (
           (c.daily_start is null and c.daily_end is null)
           or (c.daily_start is null and (now() at time zone c.timezone)::time<=c.daily_end)
           or (c.daily_end is null and (now() at time zone c.timezone)::time>=c.daily_start)
           or (
             c.daily_start<=c.daily_end
             and (now() at time zone c.timezone)::time between c.daily_start and c.daily_end
           )
           or (
             c.daily_start>c.daily_end
             and (
               (now() at time zone c.timezone)::time>=c.daily_start
               or (now() at time zone c.timezone)::time<=c.daily_end
             )
           )
         )
         and (
           (s.daily_start is null and s.daily_end is null)
           or (s.daily_start is null and (now() at time zone c.timezone)::time<=s.daily_end)
           or (s.daily_end is null and (now() at time zone c.timezone)::time>=s.daily_start)
           or (
             s.daily_start<=s.daily_end
             and (now() at time zone c.timezone)::time between s.daily_start and s.daily_end
           )
           or (
             s.daily_start>s.daily_end
             and (
               (now() at time zone c.timezone)::time>=s.daily_start
               or (now() at time zone c.timezone)::time<=s.daily_end
             )
           )
         )
         and (
           (
             s.creative_id is not null
             and exists(
               select 1 from advertising_creatives fixed
               left join media_assets fm on fm.id=fixed.media_id and fm.deleted_at is null
               where fixed.id=s.creative_id and fixed.campaign_id=s.campaign_id
                 and fixed.deleted_at is null and fixed.active=true
                 and (
                   (fixed.creative_type in ('text','banner') and (fixed.headline<>'' or fixed.body<>''))
                   or (fixed.creative_type in ('image','video') and fm.storage_path is not null)
                 )
             )
           )
           or (
             s.creative_id is null
             and exists(
               select 1 from advertising_creatives rotating
               left join media_assets rm on rm.id=rotating.media_id and rm.deleted_at is null
               where rotating.campaign_id=s.campaign_id and rotating.deleted_at is null and rotating.active=true
                 and (
                   (rotating.creative_type in ('text','banner') and (rotating.headline<>'' or rotating.body<>''))
                   or (rotating.creative_type in ('image','video') and rm.storage_path is not null)
                 )
             )
           )
         )
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
    await prepare?.();
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
    (
      await query(
        `select m.* from advertising_playouts p
       join advertising_creatives a on a.id=p.creative_id
       join media_assets m on m.id=a.media_id
       where p.id=$1`,
        [playoutId],
      )
    ).rows[0] ?? null
  );
}

export async function getAdvertisingCreativeMedia(creativeId: string) {
  return (
    (
      await query(
        `select m.* from advertising_creatives a
       join media_assets m on m.id=a.media_id
       where a.id=$1 and a.deleted_at is null and m.deleted_at is null`,
        [creativeId],
      )
    ).rows[0] ?? null
  );
}
