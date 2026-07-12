import {Readable} from 'node:stream';
import {assertPublicHttpUrl} from '@ans/security';

export interface ConnectorResult{url:string;contentType:string;body:string;etag?:string;lastModified?:string;status:number;notModified:boolean}
export interface FetchOptions{timeoutMs?:number;maxBytes?:number;etag?:string|null;lastModified?:string|null;allowPrivate?:boolean;userAgent?:string;maxRedirects?:number}
export function nextFetchAt(intervalSeconds:number,from=new Date()){return new Date(from.getTime()+intervalSeconds*1000).toISOString();}

export async function fetchHttpText(rawUrl:string,options:FetchOptions={}):Promise<ConnectorResult>{
  const timeoutMs=options.timeoutMs??20000;const maxBytes=options.maxBytes??1024*1024;const maxRedirects=options.maxRedirects??5;let current=rawUrl;
  for(let redirects=0;redirects<=maxRedirects;redirects++){
    await assertPublicHttpUrl(current,options.allowPrivate??false);
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const headers:Record<string,string>={'user-agent':options.userAgent??'AutomatedNewsStudio/1.0 (+local)'};
      if(options.etag)headers['if-none-match']=options.etag;if(options.lastModified)headers['if-modified-since']=options.lastModified;
      const res=await fetch(current,{redirect:'manual',headers,signal:controller.signal});
      if([301,302,303,307,308].includes(res.status)){const location=res.headers.get('location');if(!location)throw new Error(`Redirect ohne Location von ${current}`);current=new URL(location,current).toString();continue;}
      if(res.status===304)return{url:current,contentType:res.headers.get('content-type')??'',body:'',etag:res.headers.get('etag')??undefined,lastModified:res.headers.get('last-modified')??undefined,status:304,notModified:true};
      if(!res.ok)throw new Error(`HTTP ${res.status} beim Abruf von ${current}`);
      const len=res.headers.get('content-length');if(len&&Number(len)>maxBytes)throw new Error(`Antwort zu groß (${len} Bytes, Limit ${maxBytes})`);
      const body=await readLimited(res.body,maxBytes);
      return{url:current,contentType:res.headers.get('content-type')??'',body,etag:res.headers.get('etag')??undefined,lastModified:res.headers.get('last-modified')??undefined,status:res.status,notModified:false};
    }catch(e){if((e as Error).name==='AbortError')throw new Error(`Timeout nach ${timeoutMs} ms beim Abruf von ${current}`);throw e;}finally{clearTimeout(timer);}
  }
  throw new Error(`Zu viele Redirects für ${rawUrl}`);
}
async function readLimited(body:ReadableStream<Uint8Array>|null,maxBytes:number){if(!body)return'';let total=0;const chunks:Buffer[]=[];const node=Readable.fromWeb(body as any);for await(const chunk of node){const buf=Buffer.from(chunk);total+=buf.length;if(total>maxBytes)throw new Error(`Antwort überschreitet Größenlimit von ${maxBytes} Bytes`);chunks.push(buf);}return Buffer.concat(chunks).toString('utf8');}
