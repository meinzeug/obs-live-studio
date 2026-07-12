import argon2 from 'argon2';
import {randomBytes,timingSafeEqual} from 'node:crypto';

export type RoleName='administrator'|'redaktion'|'nur_lesen';
export const WRITE_PERMISSIONS=['sources:write','articles:write','broadcast:write','obs:write','users:write'] as const;
export type WritePermission=typeof WRITE_PERMISSIONS[number];
export const ROLE_PERMISSIONS:Record<RoleName,readonly WritePermission[]>={
  administrator:WRITE_PERMISSIONS,
  redaktion:['sources:write','articles:write','broadcast:write','obs:write'],
  nur_lesen:[]
};
export async function hashPassword(password:string){
  return argon2.hash(password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});
}
export async function verifyPassword(hash:string,password:string){return argon2.verify(hash,password);}
export function createSecret(bytes=32){return randomBytes(bytes).toString('base64url');}
export function safeEqual(a:string,b:string){const ab=Buffer.from(a);const bb=Buffer.from(b);return ab.length===bb.length&&timingSafeEqual(ab,bb);}
export function isWriteMethod(method:string){return !['GET','HEAD','OPTIONS'].includes(method.toUpperCase());}
