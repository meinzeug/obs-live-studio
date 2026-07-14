import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL fehlt');

const sources = [
  {
    name: 'Bundesregierung kompakt',
    url: 'https://www.bundesregierung.de/service/rss/breg-de/1151242/feed.xml',
    category: 'Politik',
    description: 'Offizielle Meldungen, Pressemitteilungen, Reden und Erklärungen der Bundesregierung',
    licenseNotes: 'Amtliche Primärquelle; Quelle und Originallink werden im Beitrag genannt.',
  },
  {
    name: 'Deutscher Bundestag – heute im bundestag',
    url: 'https://www.bundestag.de/static/appdata/includes/rss/hib.rss',
    category: 'Parlament',
    description: 'Offizielle Kurzmeldungen zu Ausschüssen, Drucksachen und parlamentarischen Beratungen',
    licenseNotes: 'Amtliche Primärquelle; Quelle und Originallink werden im Beitrag genannt.',
  },
];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  for (const source of sources) {
    const url = new URL(source.url);
    await pool.query(
      `insert into sources(
         name,url,domain,type,category,region,language,description,priority,trust_level,
         fetch_interval_seconds,max_articles,max_fetch_seconds,active,user_agent,license_notes
       ) values($1,$2,$3,'rss',$4,'Deutschland','de',$5,10,90,900,3,20,true,$6,$7)
       on conflict(url) do update set
         name=excluded.name,domain=excluded.domain,type=excluded.type,category=excluded.category,
         region=excluded.region,language=excluded.language,description=excluded.description,
         priority=excluded.priority,trust_level=excluded.trust_level,
         fetch_interval_seconds=excluded.fetch_interval_seconds,max_articles=excluded.max_articles,
         max_fetch_seconds=excluded.max_fetch_seconds,active=true,user_agent=excluded.user_agent,
         license_notes=excluded.license_notes,deleted_at=null,version=sources.version+1`,
      [
        source.name,
        source.url,
        url.hostname,
        source.category,
        source.description,
        process.env.NEWS_USER_AGENT ?? 'OpenTVStudio/1.0',
        source.licenseNotes,
      ],
    );
  }
  const result = await pool.query(
    `select id,name,url,trust_level,active from sources where url=any($1::text[]) order by name`,
    [sources.map((source) => source.url)],
  );
  console.log(JSON.stringify({ ok: true, sources: result.rows }));
} finally {
  await pool.end();
}
