import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {afterEach,describe,expect,it} from 'vitest';
import {fetchHttpText} from '../packages/source-connectors/src/index.js';
import {parseFeed} from '../packages/news-parser/src/index.js';

let server:ReturnType<typeof createServer>|undefined;
function listen(handler:(req:IncomingMessage,res:ServerResponse)=>void){server=createServer(handler);return new Promise<string>(resolve=>server!.listen(0,'127.0.0.1',()=>{const addr=server!.address();if(typeof addr==='object'&&addr)resolve(`http://127.0.0.1:${addr.port}`);}));}
afterEach(()=>new Promise<void>(resolve=>server?.close(()=>resolve())));

describe('source fetching',()=>{it('fetches a local test feed with validators when private sources are explicitly allowed',async()=>{const base=await listen((_req,res)=>{res.setHeader('content-type','application/rss+xml');res.setHeader('etag','"v1"');res.end('<rss><channel><item><title>Lokal</title><link>/a</link><description>Text</description></item></channel></rss>');});const result=await fetchHttpText(base+'/feed.xml',{allowPrivate:true,maxBytes:4096,timeoutMs:1000});expect(result.etag).toBe('"v1"');expect(parseFeed(result.body,result.url)[0].url).toBe(base+'/a');});it('enforces response size limits',async()=>{const base=await listen((_req,res)=>res.end('x'.repeat(128)));await expect(fetchHttpText(base,{allowPrivate:true,maxBytes:8,timeoutMs:1000})).rejects.toThrow(/Größenlimit|groß/);});});
