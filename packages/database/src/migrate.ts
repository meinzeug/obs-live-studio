import{readFile}from'node:fs/promises';import{dirname,resolve}from'node:path';import{fileURLToPath}from'node:url';import{query,pool}from'./index.js';
const here=dirname(fileURLToPath(import.meta.url));
async function readFirst(name:string){const candidates=[resolve(process.cwd(),`packages/database/src/${name}`),resolve(here,'../src',name),resolve(here,name)];for(const file of candidates){try{return await readFile(file,'utf8');}catch{}}throw new Error(`${name} nicht gefunden: ${candidates.join(', ')}`);}
for(const name of ['schema.sql','002_article_broadcast.sql','003_auth_sessions.sql','004_overlay_media_admin.sql'])await query(await readFirst(name));
await pool.end();console.log('Migrationen ausgeführt');
