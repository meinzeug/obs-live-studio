import {createHash} from 'node:crypto';
export const MAX_IMAGE_BYTES=15*1024*1024;
export const allowedImageMimes=['image/png','image/jpeg','image/webp','image/svg+xml'] as const;
export type AllowedImageMime=typeof allowedImageMimes[number];
export interface MediaInspection{mime:AllowedImageMime;size:number;sha256:string;width:number|null;height:number|null;extension:string;}
function isPng(b:Buffer){return b.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));}
function isJpeg(b:Buffer){return b[0]===0xff&&b[1]===0xd8&&b.includes(Buffer.from([0xff,0xd9]));}
function isWebp(b:Buffer){return b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP';}
function isSvg(b:Buffer){const s=b.subarray(0,512).toString('utf8').trimStart().toLowerCase();return s.startsWith('<svg')||s.startsWith('<?xml')&&s.includes('<svg');}
export function inspectImage(buffer:Buffer,declared?:string):MediaInspection{if(buffer.length===0)throw new Error('Leere Datei');if(buffer.length>MAX_IMAGE_BYTES)throw new Error('Datei ist zu groß');let mime:AllowedImageMime|undefined;let ext='bin';let width:number|null=null,height:number|null=null;if(isPng(buffer)){mime='image/png';ext='png';width=buffer.readUInt32BE(16);height=buffer.readUInt32BE(20);}else if(isJpeg(buffer)){mime='image/jpeg';ext='jpg';}else if(isWebp(buffer)){mime='image/webp';ext='webp';}else if(isSvg(buffer)){mime='image/svg+xml';ext='svg';const txt=buffer.toString('utf8');if(/<script|on\w+=|javascript:/i.test(txt))throw new Error('SVG enthält aktive Inhalte');}else throw new Error('Nicht unterstützter oder beschädigter Bildinhalt');if(declared&&declared!==mime)throw new Error(`MIME-Typ passt nicht zum Dateiinhalt (${declared} != ${mime})`);return{mime,size:buffer.length,sha256:createHash('sha256').update(buffer).digest('hex'),width,height,extension:ext};}
export function cacheHeaders(mime:string){return{'content-type':mime,'cache-control':'public, max-age=31536000, immutable','x-content-type-options':'nosniff'};}
