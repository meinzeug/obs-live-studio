import { transaction, type SourceRecord } from './index.js';
import { prepareSourceUpdate } from './source-update.js';

export async function updateSourceState(id: string, input: Record<string, unknown>) {
  return transaction(async (client) => {
    const current = (
      await client.query<SourceRecord>('select * from sources where id=$1 and deleted_at is null for update', [id])
    ).rows[0];
    if (!current) throw new Error('Quelle nicht gefunden');

    const { next, url, urlChanged, userAgent } = prepareSourceUpdate(current, input);
    const updated = (
      await client.query<SourceRecord>(
        `update sources
         set name=$2,
             url=$3,
             domain=$4,
             type=$5,
             category=$6,
             region=$7,
             language=$8,
             description=$9,
             priority=$10,
             trust_level=$11,
             fetch_interval_seconds=$12,
             max_articles=$13,
             max_fetch_seconds=$14,
             active=$15,
             user_agent=$16,
             etag=case when $17 then null else etag end,
             last_modified=case when $17 then null else last_modified end,
             last_success_at=case when $17 then null else last_success_at end,
             last_error=case when $17 then null else last_error end,
             consecutive_errors=case when $17 then 0 else consecutive_errors end,
             version=version+1
         where id=$1 and deleted_at is null
         returning *`,
        [
          id,
          next.name,
          next.url,
          url.hostname,
          next.type,
          next.category,
          next.region,
          next.language,
          next.description,
          next.priority,
          next.trustLevel ?? next.trust_level,
          next.fetchIntervalSeconds ?? next.fetch_interval_seconds,
          next.maxArticles ?? next.max_articles,
          next.maxFetchSeconds ?? next.max_fetch_seconds,
          next.active,
          userAgent,
          urlChanged,
        ],
      )
    ).rows[0];

    if (!updated) throw new Error('Quelle nicht gefunden');
    return updated;
  });
}
