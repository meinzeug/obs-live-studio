import{spawn}from'node:child_process';
export function ffmpeg(args:string[]){return new Promise<void>((res,rej)=>{const p=spawn('ffmpeg',args);let e='';p.stderr.on('data',d=>e+=d);p.on('close',c=>c===0?res():rej(new Error(e)));});}
export async function normalizeAudio(input:string,output:string){await ffmpeg(['-y','-i',input,'-af','loudnorm=I=-16:TP=-1.5:LRA=11',output]);return output;}
