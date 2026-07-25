import { query, transaction } from './index.js';

export type EditorialDeskSettings = {
  id: boolean;
  enabled: boolean;
  cycle_interval_minutes: number;
  region_focus: string;
  max_stories_per_cycle: number;
  minimum_distinct_sources: number;
  create_staff_assignments: boolean;
  local_fallback_enabled: boolean;
  next_cycle_at: string;
  updated_at: string;
};

export type EditorialDeskCycle = {
  id: string;
  trigger: 'scheduled' | 'manual' | 'startup';
  status: 'running' | 'completed' | 'degraded' | 'failed';
  evidence_fingerprint: string | null;
  new_articles: number;
  reviewed_articles: number;
  approved_articles: number;
  distinct_sources: number;
  topics: Array<Record<string, unknown>>;
  assignments: Array<Record<string, unknown>>;
  summary: string | null;
  fallback_used: boolean;
  error: string | null;
  started_at: string;
  completed_at: string | null;
};

export async function getEditorialDeskSettings() {
  return (await query<EditorialDeskSettings>('select * from editorial_desk_settings where id=true')).rows[0];
}

export async function updateEditorialDeskSettings(
  input: Partial<{
    enabled: boolean;
    cycleIntervalMinutes: number;
    regionFocus: string;
    maxStoriesPerCycle: number;
    minimumDistinctSources: number;
    createStaffAssignments: boolean;
    localFallbackEnabled: boolean;
    nextCycleAt: string;
  }>,
) {
  return (
    await query<EditorialDeskSettings>(
      `update editorial_desk_settings set
         enabled=coalesce($1,enabled),
         cycle_interval_minutes=coalesce($2,cycle_interval_minutes),
         region_focus=coalesce($3,region_focus),
         max_stories_per_cycle=coalesce($4,max_stories_per_cycle),
         minimum_distinct_sources=coalesce($5,minimum_distinct_sources),
         create_staff_assignments=coalesce($6,create_staff_assignments),
         local_fallback_enabled=coalesce($7,local_fallback_enabled),
         next_cycle_at=coalesce($8::timestamptz,next_cycle_at),
         updated_at=now()
       where id=true returning *`,
      [
        input.enabled ?? null,
        input.cycleIntervalMinutes ?? null,
        input.regionFocus ?? null,
        input.maxStoriesPerCycle ?? null,
        input.minimumDistinctSources ?? null,
        input.createStaffAssignments ?? null,
        input.localFallbackEnabled ?? null,
        input.nextCycleAt ?? null,
      ],
    )
  ).rows[0];
}

export async function requestEditorialDeskCycle() {
  return updateEditorialDeskSettings({ nextCycleAt: new Date().toISOString() });
}

export async function claimEditorialDeskCycle(trigger: EditorialDeskCycle['trigger'] = 'scheduled') {
  return transaction(async (client) => {
    const settings = (
      await client.query<EditorialDeskSettings>('select * from editorial_desk_settings where id=true for update')
    ).rows[0];
    if (!settings?.enabled) return null;
    if (trigger === 'scheduled' && new Date(settings.next_cycle_at).getTime() > Date.now()) return null;
    const active = (
      await client.query<EditorialDeskCycle>(
        `select * from editorial_desk_cycles
         where status='running' and started_at>now()-interval '30 minutes'
         order by started_at desc limit 1`,
      )
    ).rows[0];
    if (active) return null;
    await client.query(
      `update editorial_desk_settings
       set next_cycle_at=now()+(cycle_interval_minutes||' minutes')::interval,updated_at=now()
       where id=true`,
    );
    return (
      await client.query<EditorialDeskCycle>(
        `insert into editorial_desk_cycles(trigger,status) values($1,'running') returning *`,
        [trigger],
      )
    ).rows[0];
  });
}

export async function completeEditorialDeskCycle(
  id: string,
  input: {
    status: 'completed' | 'degraded';
    evidenceFingerprint: string;
    newArticles: number;
    reviewedArticles: number;
    approvedArticles: number;
    distinctSources: number;
    topics: Array<Record<string, unknown>>;
    assignments: Array<Record<string, unknown>>;
    summary: string;
    fallbackUsed: boolean;
  },
) {
  return (
    await query<EditorialDeskCycle>(
      `update editorial_desk_cycles set
         status=$2,evidence_fingerprint=$3,new_articles=$4,reviewed_articles=$5,approved_articles=$6,
         distinct_sources=$7,topics=$8,assignments=$9,summary=$10,fallback_used=$11,
         completed_at=now(),error=null
       where id=$1 returning *`,
      [
        id,
        input.status,
        input.evidenceFingerprint,
        input.newArticles,
        input.reviewedArticles,
        input.approvedArticles,
        input.distinctSources,
        JSON.stringify(input.topics),
        JSON.stringify(input.assignments),
        input.summary,
        input.fallbackUsed,
      ],
    )
  ).rows[0];
}

export async function failEditorialDeskCycle(id: string, error: string) {
  return (
    await query<EditorialDeskCycle>(
      `update editorial_desk_cycles
       set status='failed',error=$2,completed_at=now()
       where id=$1 returning *`,
      [id, error.slice(0, 1500)],
    )
  ).rows[0];
}

export async function editorialDeskStatus() {
  const [settings, cycle, metrics, activity] = await Promise.all([
    getEditorialDeskSettings(),
    query<EditorialDeskCycle>('select * from editorial_desk_cycles order by started_at desc limit 1'),
    query<{
      fresh_articles: number;
      new_articles: number;
      review_articles: number;
      approved_articles: number;
      published_articles: number;
      active_sources: number;
      healthy_sources: number;
      distinct_sources_24h: number;
    }>(
      `select
        (select count(*)::int from articles where deleted_at is null and fetched_at>now()-interval '24 hours') fresh_articles,
        (select count(*)::int from articles where deleted_at is null and status='new') new_articles,
        (select count(*)::int from articles where deleted_at is null and status='review') review_articles,
        (select count(*)::int from articles where deleted_at is null and status='approved') approved_articles,
        (select count(*)::int from articles where deleted_at is null and status='published') published_articles,
        (select count(*)::int from sources where deleted_at is null and active=true) active_sources,
        (select count(*)::int from sources where deleted_at is null and active=true and consecutive_errors=0) healthy_sources,
        (select count(distinct source_id)::int from articles where deleted_at is null and fetched_at>now()-interval '24 hours') distinct_sources_24h`,
    ),
    query<{
      staff_member_id: string;
      display_name: string;
      title: string;
      status: string | null;
      created_at: string;
    }>(
      `select activity.staff_member_id,member.display_name,activity.title,activity.status,activity.created_at
       from ai_staff_activity activity
       join ai_staff_members member on member.id=activity.staff_member_id
       where activity.event_type like 'editorial_desk_%'
       order by activity.created_at desc limit 12`,
    ),
  ]);
  return {
    settings,
    lastCycle: cycle.rows[0] ?? null,
    metrics: metrics.rows[0],
    activity: activity.rows,
    serverTime: new Date().toISOString(),
  };
}
