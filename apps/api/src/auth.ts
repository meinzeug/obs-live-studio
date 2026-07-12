import type {FastifyInstance,FastifyReply,FastifyRequest} from 'fastify';
import {createSecret,hashPassword,isWriteMethod,safeEqual,verifyPassword,type RoleName,type WritePermission} from '@ans/security/auth';
import {createSession,createUser,deleteSession,ensureAuthDefaults,getAuthUser,getSession,getUserForLogin,listUsers,needsInitialAdmin,pruneSessions} from '@ans/database/auth';
import {z} from 'zod';

declare module 'fastify'{interface FastifyRequest{user?:Awaited<ReturnType<typeof getAuthUser>>;sessionId?:string;csrfToken?:string;}}
const COOKIE='ans_session';
const ttl=60*60*12;
function secureCookie(){return process.env.NODE_ENV==='production'||process.env.COOKIE_SECURE==='true';}
function setCookie(reply:FastifyReply,id:string){reply.setCookie(COOKIE,id,{path:'/',httpOnly:true,sameSite:'lax',secure:secureCookie(),maxAge:ttl});}
function clearCookie(reply:FastifyReply){reply.clearCookie(COOKIE,{path:'/',httpOnly:true,sameSite:'lax',secure:secureCookie()});}
export async function registerAuth(app:FastifyInstance){
  await ensureAuthDefaults();await pruneSessions();
  app.addHook('preHandler',async(req,reply)=>{const sid=req.cookies[COOKIE];if(sid){const session=await getSession(sid);if(session){const user=await getAuthUser(session.user_id);if(user?.active){req.user=user;req.sessionId=session.id;req.csrfToken=session.csrf_token;}}}if(isWriteMethod(req.method)&&req.url.startsWith('/api/')&&!req.url.startsWith('/api/auth/')){if(!req.user){reply.code(401);throw new Error('Anmeldung erforderlich');}const token=req.headers['x-csrf-token'];if(typeof token!=='string'||!req.csrfToken||!safeEqual(token,req.csrfToken)){reply.code(403);throw new Error('CSRF-Token fehlt oder ist ungültig');}}});
  app.get('/api/auth/setup-required',async()=>({required:await needsInitialAdmin()}));
  app.post('/api/auth/setup',async(req,reply)=>{if(!await needsInitialAdmin()){reply.code(409);throw new Error('Erstadministrator existiert bereits');}const body=z.object({email:z.string().email(),displayName:z.string().min(1),password:z.string().min(12)}).parse(req.body);const user=await createUser({email:body.email,displayName:body.displayName,passwordHash:await hashPassword(body.password),role:'administrator'});const csrf=createSecret();const session=await createSession(user.id,csrf,ttl);setCookie(reply,session.id);return{user:{...user,permissions:['sources:write','articles:write','broadcast:write','obs:write','users:write']},csrfToken:csrf};});
  app.post('/api/auth/login',async(req,reply)=>{const body=z.object({email:z.string().email(),password:z.string().min(1)}).parse(req.body);const user=await getUserForLogin(body.email);if(!user?.active||!await verifyPassword(user.password_hash,body.password)){reply.code(401);throw new Error('E-Mail oder Passwort ist falsch');}const csrf=createSecret();const session=await createSession(user.id,csrf,ttl);setCookie(reply,session.id);return{user:await getAuthUser(user.id),csrfToken:csrf};});
  app.post('/api/auth/logout',async(req,reply)=>{if(req.sessionId)await deleteSession(req.sessionId);clearCookie(reply);return{ok:true};});
  app.get('/api/auth/session',async(req)=>({authenticated:Boolean(req.user),user:req.user??null,csrfToken:req.csrfToken??null,setupRequired:await needsInitialAdmin()}));
  app.get('/api/auth/users',async(req,reply)=>{requirePermission(req,reply,'users:write');return listUsers();});
}
export function requirePermission(req:FastifyRequest,reply:FastifyReply,permission:WritePermission){if(!req.user){reply.code(401);throw new Error('Anmeldung erforderlich');}if(req.user.role!=='administrator'&&!req.user.permissions.includes(permission)){reply.code(403);throw new Error('Keine Berechtigung für diese Aktion');}}
export function requireRole(req:FastifyRequest,reply:FastifyReply,roles:RoleName[]){if(!req.user){reply.code(401);throw new Error('Anmeldung erforderlich');}if(!roles.includes(req.user.role)){reply.code(403);throw new Error('Rolle nicht berechtigt');}}
