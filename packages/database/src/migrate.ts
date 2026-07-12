import{readFile}from'node:fs/promises';import{join}from'node:path';import{query,pool}from'./index.js';
const sql=await readFile(join(process.cwd(),'packages/database/src/schema.sql'),'utf8');await query(sql);await pool.end();console.log('Migrationen ausgeführt');
