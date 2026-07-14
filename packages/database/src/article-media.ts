import type { QueryResultRow } from 'pg';
import { query, transaction } from './index.js';

export type ArticleMediaKind = 'video' | 'image' | 'graphic' | 'statistic' | 'reference';
export type ArticleMediaStatus = 'candidate' | 'importing' | 'approved' | 'rejected' | 'reference' | 'failed';

export interface ArticleMediaCandidateInput {
  kind: ArticleMediaKind;
  provider: string;
  providerAssetId: string;
  title: string;
  searchQuery: string;
  sourceUrl: string;
  downloadUrl?: string | null;
  previewUrl?: string | null;
  embedUrl?: string | null;
  mimeType?: string | null;
  durationSeconds?: number | null;
  width?: number | null;
  height?: number | null;
  author?: string | null;
  licenseName?: string | null;
  licenseUrl?: string | null;
  attribution?: string | null;
  relevanceScore?: number;
  rightsStatus?: 'approved' | 'review' | 'restricted' | 'unknown';
  status?: ArticleMediaStatus;
  metadata?: Record<string, unknown>;
}

export interface ArticleMediaCandidateRecord extends QueryResultRow {
  id: string;
  article_id: string;
  media_id: string | null;
  kind: ArticleMediaKind;
  provider: string;
  provider_asset_id: string;
  title: string;
  search_query: string;
  source_url: string;
  download_url: string | null;
  preview_url: string | null;
  embed_url: string | null;
  mime_type: string | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  author: string | null;
  license_name: string | null;
  license_url: string | null;
  attribution: string | null;
  relevance_score: number;
  rights_status: string;
  status: ArticleMediaStatus;
  metadata: Record<string, unknown>;
  error: string | null;
  storage_path?: string | null;
  created_at: string;
  updated_at: string;
}

export async function queueArticleMediaDiscovery(articleId: string) {
  return (
    await query(
      `insert into worker_jobs(kind,payload,status,scheduled_at,max_attempts)
       values('discover-article-media',jsonb_build_object('articleId',$1),'queued',now(),3)
       on conflict do nothing
       returning *`,
      [articleId],
    )
  ).rows[0] ?? null;
}

export async function upsertArticleMediaCandidates(articleId: string, candidates: ArticleMediaCandidateInput[]) {
  const rows: ArticleMediaCandidateRecord[] = [];
  for (const candidate of candidates) {
    const row = (
      await query<ArticleMediaCandidateRecord>(
        `insert into article_media_candidates(
           article_id,kind,provider,provider_asset_id,title,search_query,source_url,download_url,preview_url,
           embed_url,mime_type,duration_seconds,width,height,author,license_name,license_url,attribution,
           relevance_score,rights_status,status,metadata,updated_at
         ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,now())
         on conflict(article_id,provider,provider_asset_id,kind) do update set
           title=excluded.title,search_query=excluded.search_query,source_url=excluded.source_url,
           download_url=excluded.download_url,preview_url=excluded.preview_url,embed_url=excluded.embed_url,
           mime_type=excluded.mime_type,duration_seconds=excluded.duration_seconds,width=excluded.width,
           height=excluded.height,author=excluded.author,license_name=excluded.license_name,
           license_url=excluded.license_url,attribution=excluded.attribution,
           relevance_score=greatest(article_media_candidates.relevance_score,excluded.relevance_score),
           rights_status=excluded.rights_status,metadata=excluded.metadata,updated_at=now()
         returning *`,
        [
          articleId,
          candidate.kind,
          candidate.provider,
          candidate.providerAssetId,
          candidate.title,
          candidate.searchQuery,
          candidate.sourceUrl,
          candidate.downloadUrl ?? null,
          candidate.previewUrl ?? null,
          candidate.embedUrl ?? null,
          candidate.mimeType ?? null,
          candidate.durationSeconds ?? null,
          candidate.width ?? null,
          candidate.height ?? null,
          candidate.author ?? null,
          candidate.licenseName ?? null,
          candidate.licenseUrl ?? null,
          candidate.attribution ?? null,
          candidate.relevanceScore ?? 0,
          candidate.rightsStatus ?? 'review',
          candidate.status ?? (candidate.kind === 'reference' ? 'reference' : 'candidate'),
          candidate.metadata ?? {},
        ],
      )
    ).rows[0];
    rows.push(row);
  }
  return rows;
}

export async function listArticleMediaCandidates(articleId: string) {
  return (
    await query<ArticleMediaCandidateRecord>(
      `select c.*,ma.storage_path
       from article_media_candidates c
       left join media_assets ma on ma.id=c.media_id
       where c.article_id=$1
       order by case c.status when 'approved' then 0 when 'candidate' then 1 when 'reference' then 2 else 3 end,
                c.relevance_score desc,c.created_at desc`,
      [articleId],
    )
  ).rows;
}

export async function getArticleMediaCandidate(articleId: string, candidateId: string) {
  return (
    await query<ArticleMediaCandidateRecord>(
      `select c.*,ma.storage_path
       from article_media_candidates c
       left join media_assets ma on ma.id=c.media_id
       where c.article_id=$1 and c.id=$2`,
      [articleId, candidateId],
    )
  ).rows[0] ?? null;
}

export async function markArticleMediaCandidate(
  articleId: string,
  candidateId: string,
  status: ArticleMediaStatus,
  error?: string | null,
  userId?: string | null,
) {
  return (
    await query<ArticleMediaCandidateRecord>(
      `update article_media_candidates
       set status=$3,error=$4,reviewed_by=case when $3 in ('approved','rejected') then $5 else reviewed_by end,
           reviewed_at=case when $3 in ('approved','rejected') then now() else reviewed_at end,updated_at=now()
       where article_id=$1 and id=$2 returning *`,
      [articleId, candidateId, status, error?.slice(0, 1000) ?? null, userId ?? null],
    )
  ).rows[0] ?? null;
}

export async function approveArticleMediaCandidate(input: {
  articleId: string;
  candidateId: string;
  userId?: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  sha256: string;
  durationSeconds?: number | null;
  width?: number | null;
  height?: number | null;
  derivativePaths?: Record<string, unknown>;
}) {
  return transaction(async (client) => {
    const candidate = (
      await client.query<ArticleMediaCandidateRecord>(
        `select * from article_media_candidates where article_id=$1 and id=$2 for update`,
        [input.articleId, input.candidateId],
      )
    ).rows[0];
    if (!candidate) throw new Error('Medienkandidat nicht gefunden');
    if (candidate.kind !== 'video' && candidate.kind !== 'image' && candidate.kind !== 'graphic') {
      throw new Error('Dieser Kandidat kann nicht als lokale Mediendatei freigegeben werden');
    }
    const usage = candidate.kind === 'video' ? 'article-video' : 'article-graphic';
    const media = (
      await client.query(
        `insert into media_assets(
           filename,mime_type,size_bytes,resolution,duration_seconds,source,author,original_url,usage,
           storage_path,sha256,attribution,license_name,license_url,metadata,derivative_paths,
           media_kind,provider,provider_asset_id,preview_url
         ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         on conflict(provider,provider_asset_id) where provider is not null and provider_asset_id is not null
         do update set storage_path=excluded.storage_path,sha256=excluded.sha256,size_bytes=excluded.size_bytes,
           duration_seconds=excluded.duration_seconds,resolution=excluded.resolution,metadata=excluded.metadata,
           derivative_paths=excluded.derivative_paths
         returning *`,
        [
          input.filename,
          input.mimeType,
          input.sizeBytes,
          input.width && input.height ? `${input.width}x${input.height}` : null,
          input.durationSeconds ?? candidate.duration_seconds,
          candidate.source_url,
          candidate.author,
          candidate.source_url,
          usage,
          input.storagePath,
          input.sha256,
          candidate.attribution,
          candidate.license_name,
          candidate.license_url,
          {
            ...(candidate.metadata ?? {}),
            width: input.width ?? candidate.width,
            height: input.height ?? candidate.height,
            importedAt: new Date().toISOString(),
          },
          input.derivativePaths ?? {},
          candidate.kind,
          candidate.provider,
          candidate.provider_asset_id,
          candidate.preview_url,
        ],
      )
    ).rows[0];
    await client.query(`delete from media_links where article_id=$1 and purpose=$2`, [input.articleId, usage]);
    await client.query(
      `insert into media_links(media_id,article_id,purpose) values($1,$2,$3)`,
      [media.id, input.articleId, usage],
    );
    const approved = (
      await client.query<ArticleMediaCandidateRecord>(
        `update article_media_candidates
         set media_id=$3,status='approved',error=null,rights_status='approved',reviewed_by=$4,reviewed_at=now(),updated_at=now()
         where article_id=$1 and id=$2 returning *`,
        [input.articleId, input.candidateId, media.id, input.userId ?? null],
      )
    ).rows[0];
    return { candidate: approved, media };
  });
}

export async function getArticleMediaReadiness(articleId: string) {
  const row = (
    await query<{
      approved_videos: number;
      approved_graphics: number;
      candidates: number;
      references: number;
    }>(
      `select
         count(*) filter(where c.status='approved' and c.kind='video' and ma.storage_path is not null)::int approved_videos,
         count(*) filter(where c.status='approved' and c.kind in ('image','graphic') and ma.storage_path is not null)::int approved_graphics,
         count(*) filter(where c.status='candidate')::int candidates,
         count(*) filter(where c.status='reference')::int references
       from article_media_candidates c
       left join media_assets ma on ma.id=c.media_id
       where c.article_id=$1`,
      [articleId],
    )
  ).rows[0] ?? { approved_videos: 0, approved_graphics: 0, candidates: 0, references: 0 };
  return {
    ...row,
    ready: Number(row.approved_videos) >= 1,
  };
}

export async function getApprovedArticleVideo(articleId: string) {
  return (
    await query<{
      media_id: string;
      filename: string;
      storage_path: string;
      mime_type: string;
      duration_seconds: number | null;
      attribution: string | null;
      license_name: string | null;
      source: string | null;
    }>(
      `select ma.id media_id,ma.filename,ma.storage_path,ma.mime_type,ma.duration_seconds,
              ma.attribution,ma.license_name,ma.source
       from media_links ml
       join media_assets ma on ma.id=ml.media_id
       where ml.article_id=$1 and ml.purpose='article-video' and ma.storage_path is not null
       order by ml.created_at desc limit 1`,
      [articleId],
    )
  ).rows[0] ?? null;
}
