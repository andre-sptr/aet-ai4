import { spawn } from 'node:child_process';
const children=['dev:api','dev:web'].map(script=>spawn('npm',['run',script],{stdio:'inherit'}));
let stopping=false;
function stop(){if(stopping)return;stopping=true;for(const child of children)child.kill('SIGTERM');}
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,stop);
for(const child of children)child.on('exit',code=>{if(!stopping){process.exitCode=code??1;stop();}});
