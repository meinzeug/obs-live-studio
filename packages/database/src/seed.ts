import{query,pool}from'./index.js';
await query(`insert into roles(name,description) values('Administrator','Vollzugriff'),('Redaktion','Nachrichten prüfen'),('Moderator','Sendebetrieb'),('Designer','Overlays und Szenen'),('Nur-Lesen','Leserechte') on conflict do nothing`);
await query(`insert into categories(name) values('Politik'),('Wirtschaft'),('Region'),('Wetter'),('Verkehr'),('Eilmeldung') on conflict do nothing`);
await query(`insert into sources(name,url,domain,type,category,region,language,priority,trust_level,fetch_interval_seconds,active) values('Demo Lokalfeed','http://127.0.0.1:12000/demo/feed.xml','127.0.0.1','rss','Region','Demo','de',5,80,900,false) on conflict do nothing`);
await pool.end();console.log('Seed-Daten eingefügt');
