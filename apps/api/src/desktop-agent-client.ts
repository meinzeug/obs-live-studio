export interface AgentResponse{ok?:boolean;status?:unknown;error?:string;}
const base=process.env.DESKTOP_AGENT_URL??'http://127.0.0.1:12090';
const token=process.env.DESKTOP_AGENT_TOKEN??'dev-local-agent-token';
export async function agentRequest(path:string,method='GET'){const r=await fetch(`${base}${path}`,{method,headers:{authorization:`Bearer ${token}`}});const text=await r.text();const data=text?JSON.parse(text):{};if(!r.ok)throw new Error(data.error??`Desktop-Agent Fehler ${r.status}`);return data;}
export async function obsProcessStatus(){return (await agentRequest('/status')).status;}
export async function startObsProcess(){return (await agentRequest('/obs/start','POST')).status;}
export async function stopObsProcess(){return (await agentRequest('/obs/stop','POST')).status;}
export async function restartObsProcess(){return (await agentRequest('/obs/restart','POST')).status;}
