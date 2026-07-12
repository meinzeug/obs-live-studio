import{spawn}from'node:child_process';import{existsSync}from'node:fs';
export function checkGraphicsSession(){return{display:process.env.DISPLAY,wayland:process.env.WAYLAND_DISPLAY,xdgRuntimeDir:process.env.XDG_RUNTIME_DIR,canStartObs:Boolean(process.env.DISPLAY||process.env.WAYLAND_DISPLAY)}}
export function startObs(){const exe=process.env.OBS_EXECUTABLE??'/usr/bin/obs';if(!existsSync(exe))throw new Error(`OBS nicht gefunden: ${exe}`);return spawn(exe,['--profile','Automated News Studio','--collection','Automated News Studio'],{detached:true,stdio:'ignore'}).unref();}
if(import.meta.url===`file://${process.argv[1]}`)console.log(JSON.stringify({component:'desktop-agent',graphics:checkGraphicsSession()}));
