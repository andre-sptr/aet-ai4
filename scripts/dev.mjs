import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnProjectCommand } from './project-command.mjs';

export function startDevelopment({ spawnCommand = spawnProjectCommand, onError = console.error, onExit = code => { process.exitCode = code; } } = {}) {
  const children=[];
  let stopping=false;
  function stop(){if(stopping)return;stopping=true;for(const child of children)child.kill('SIGTERM');}
  function failed(error){if(stopping)return;onError(error.message);onExit(1);stop();}
  for(const script of ['dev:api','dev:web']) {
    try {
      const child=spawnCommand('npm',['run',script]);
      children.push(child);
      child.once('error',failed);
      child.once('exit',code=>{if(!stopping){onExit(code??1);stop();}});
    } catch(error) {failed(error);break;}
  }
  return stop;
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const stop=startDevelopment();
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,stop);
}
