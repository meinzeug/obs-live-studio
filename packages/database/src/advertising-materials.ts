import { query } from './index.js';

export type AdvertisingMaterialInput = {
  campaignId?: string | null;
  name: string;
  materialKind: 'flyer' | 'poster' | 'social' | 'tshirt' | 'card';
  formatPreset: 'a6' | 'a5' | 'a4' | 'a3' | 'square' | 'story' | 'tshirt';
  orientation: 'portrait' | 'landscape';
  visualStyle: 'broadcast' | 'editorial' | 'bold' | 'minimal' | 'community';
  headline: string;
  body: string;
  callToAction: string;
  website: string;
  advertiser: string;
  primaryColor: string;
  accentColor: string;
  textColor: string;
  backgroundMode: 'gradient' | 'dark' | 'light' | 'accent';
  design?: Record<string, unknown>;
  status?: 'draft' | 'ready';
};

const selectProject = `
  select p.*,c.name campaign_name,
    coalesce((
      select jsonb_agg(to_jsonb(e) order by e.created_at desc)
      from advertising_material_exports e where e.project_id=p.id
    ),'[]'::jsonb) exports
  from advertising_material_projects p
  left join advertising_campaigns c on c.id=p.campaign_id`;

export async function advertisingMaterialsDashboard() {
  const [projects, campaigns] = await Promise.all([
    query(`${selectProject} where p.status<>'archived' order by p.updated_at desc`),
    query(`select id,name,advertiser,status from advertising_campaigns where status<>'archived' order by created_at desc`),
  ]);
  return { projects: projects.rows, campaigns: campaigns.rows };
}

export async function getAdvertisingMaterialProject(id: string) {
  return (await query(`${selectProject} where p.id=$1`, [id])).rows[0] ?? null;
}

export async function createAdvertisingMaterialProject(input: AdvertisingMaterialInput, userId?: string | null) {
  return (
    await query(
      `insert into advertising_material_projects(
         campaign_id,name,material_kind,format_preset,orientation,visual_style,headline,body,
         call_to_action,website,advertiser,primary_color,accent_color,text_color,background_mode,
         design,status,created_by
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       returning *`,
      [
        input.campaignId ?? null,
        input.name,
        input.materialKind,
        input.formatPreset,
        input.orientation,
        input.visualStyle,
        input.headline,
        input.body,
        input.callToAction,
        input.website,
        input.advertiser,
        input.primaryColor,
        input.accentColor,
        input.textColor,
        input.backgroundMode,
        input.design ?? {},
        input.status ?? 'draft',
        userId ?? null,
      ],
    )
  ).rows[0];
}

export async function updateAdvertisingMaterialProject(id: string, input: AdvertisingMaterialInput) {
  return (
    await query(
      `update advertising_material_projects set
         campaign_id=$2,name=$3,material_kind=$4,format_preset=$5,orientation=$6,visual_style=$7,
         headline=$8,body=$9,call_to_action=$10,website=$11,advertiser=$12,primary_color=$13,
         accent_color=$14,text_color=$15,background_mode=$16,design=$17,status=$18,updated_at=now()
       where id=$1 and status<>'archived' returning *`,
      [
        id,
        input.campaignId ?? null,
        input.name,
        input.materialKind,
        input.formatPreset,
        input.orientation,
        input.visualStyle,
        input.headline,
        input.body,
        input.callToAction,
        input.website,
        input.advertiser,
        input.primaryColor,
        input.accentColor,
        input.textColor,
        input.backgroundMode,
        input.design ?? {},
        input.status ?? 'draft',
      ],
    )
  ).rows[0] ?? null;
}

export async function archiveAdvertisingMaterialProject(id: string) {
  return (
    await query(
      `update advertising_material_projects set status='archived',updated_at=now()
       where id=$1 returning *`,
      [id],
    )
  ).rows[0] ?? null;
}

export async function createAdvertisingMaterialExport(input: {
  projectId: string;
  exportType: 'png' | 'pdf' | 'jpeg';
  formatPreset: string;
  widthPx: number;
  heightPx: number;
  dpi: number;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
}) {
  return (
    await query(
      `insert into advertising_material_exports(
         project_id,export_type,format_preset,width_px,height_px,dpi,storage_path,mime_type,size_bytes
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [
        input.projectId,
        input.exportType,
        input.formatPreset,
        input.widthPx,
        input.heightPx,
        input.dpi,
        input.storagePath,
        input.mimeType,
        input.sizeBytes,
      ],
    )
  ).rows[0];
}

export async function getAdvertisingMaterialExport(id: string) {
  return (
    await query(
      `select e.*,p.name project_name
       from advertising_material_exports e
       join advertising_material_projects p on p.id=e.project_id
       where e.id=$1`,
      [id],
    )
  ).rows[0] ?? null;
}
