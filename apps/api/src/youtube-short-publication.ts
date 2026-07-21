import type { YoutubeShortJob, YoutubeShortsSettings } from '@ans/database/youtube-shorts';

export type YoutubeShortPublication = {
  title: string;
  description: string;
  tags: string[];
  privacyStatus: 'private' | 'unlisted' | 'public';
};

function template(value: string, job: YoutubeShortJob) {
  return value
    .replaceAll('{title}', job.source_title)
    .replaceAll('{channel}', job.source_channel)
    .replaceAll('{url}', job.source_url)
    .replaceAll('{commentary}', job.commentary_text);
}

function storedPublication(job: YoutubeShortJob) {
  const publication = job.metadata?.publication;
  return publication && typeof publication === 'object' && !Array.isArray(publication)
    ? (publication as Record<string, unknown>)
    : {};
}

export function youtubeShortPublication(
  job: YoutubeShortJob,
  settings: YoutubeShortsSettings,
): YoutubeShortPublication {
  const stored = storedPublication(job);
  const privacyStatus = ['private', 'unlisted', 'public'].includes(String(stored.privacyStatus))
    ? (stored.privacyStatus as YoutubeShortPublication['privacyStatus'])
    : settings.privacy_status;
  const tags = Array.isArray(stored.tags)
    ? stored.tags
        .map((tag) => (typeof tag === 'string' ? tag.trim().slice(0, 60) : ''))
        .filter(Boolean)
        .slice(0, 30)
    : settings.tags;
  return {
    title:
      (typeof stored.title === 'string' && stored.title.trim()) || template(settings.title_template, job).slice(0, 100),
    description:
      (typeof stored.description === 'string' && stored.description.trim()) ||
      template(settings.description_template, job).slice(0, 5000),
    tags,
    privacyStatus,
  };
}
