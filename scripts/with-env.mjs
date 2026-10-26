import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnProjectCommand } from './project-command.mjs';
import { config } from 'dotenv';
const root = fileURLToPath(new URL('../', import.meta.url));
const loaded=config({path:resolve(root,'.env'),quiet:true});
const [command,...args] = process.argv.slice(2);
if (!command) throw new Error('A command is required.');
const env = {...process.env};
if (args.includes('--workspace=@aet/web')) {
  for (const name of Object.keys(loaded.parsed??{})) if(!name.startsWith('NEXT_PUBLIC_'))delete env[name];
  for (const name of ['DATABASE_URL','SESSION_SECRET','SUMOPOD_API_KEY','TAVILY_API_KEY','BLOB_READ_WRITE_TOKEN','STATIC_REBUILD_HOOK_URL','APP_ORIGIN']) delete env[name];
}
try {
  const child=spawnProjectCommand(command,args,{cwd:root,env});
  for(const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>child.kill(signal));
  child.on('error',error=>{console.error(error.message);process.exitCode=1;});
  child.on('exit',code=>{process.exitCode=code??1;});
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Perintah proyek tidak dapat dijalankan.');
  process.exitCode=1;
}
