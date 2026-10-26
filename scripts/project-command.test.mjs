import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import test from 'node:test';
import { resolveProjectCommand, spawnProjectCommand } from './project-command.mjs';
import { startDevelopment } from './dev.mjs';

test('Windows npm, TSX, and Prisma launch Node CLI entrypoints without .cmd shims',()=>{
  const node='C:\\Program Files\\nodejs\\node.exe';
  const npm='C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';
  const resolved=[];
  const options={platform:'win32',execPath:node,env:{npm_execpath:npm},fileExists:()=>true,resolveModule:name=>{resolved.push(name);return `C:\\Andre\\AET AI\\node_modules\\${name}`;}};
  assert.deepEqual(resolveProjectCommand('npm',['run','dev:web'],options),{command:node,args:[npm,'run','dev:web']});
  assert.equal(resolveProjectCommand('tsx',['scripts/migrate.ts'],options).command,node);
  assert.equal(resolveProjectCommand('prisma',['generate'],options).command,node);
  assert.deepEqual(resolved,['tsx/cli','prisma/build/index.js']);
  assert.deepEqual(resolveProjectCommand('node',['server.js'],options),{command:node,args:['server.js']});
});

test('direct invocation locates npm beside Windows Node or the Unix Node installation',()=>{
  const windowsNpm='C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';
  assert.equal(resolveProjectCommand('npm',[],{platform:'win32',execPath:'C:\\Program Files\\nodejs\\node.exe',env:{},fileExists:path=>path===windowsNpm}).args[0],windowsNpm);
  const unixNpm='/opt/node/lib/node_modules/npm/bin/npm-cli.js';
  assert.equal(resolveProjectCommand('npm',[],{platform:'linux',execPath:'/opt/node/bin/node',env:{},fileExists:path=>path===unixNpm}).args[0],unixNpm);
  assert.throws(()=>resolveProjectCommand('npm',[],{env:{},fileExists:()=>false}),/npm CLI tidak ditemukan/);
});

test('installed Prisma and TSX resolve their supported package exports',()=>{
  for(const command of ['prisma','tsx']) {
    const invocation=resolveProjectCommand(command,['--version']);
    assert.equal(invocation.command,process.execPath);
    assert.ok(existsSync(invocation.args[0]));
    assert.deepEqual(invocation.args.slice(1),['--version']);
  }
});

test('real child execution preserves spaces and literal shell metacharacters in paths and arguments',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'aet CLI with spaces '));
  try {
    const file=join(directory,'arguments with spaces.mjs');
    await writeFile(file,'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
    const args=['two words','a&b','$(literal)','"quoted"','x; y'];
    const child=spawnProjectCommand('node',[file,...args],{stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',data=>{output+=data;});
    assert.equal((await once(child,'close'))[0],0);
    assert.deepEqual(JSON.parse(output),args);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('environment wrapper launches the installed TSX JavaScript CLI',async()=>{
  const child=spawnProjectCommand('node',['scripts/with-env.mjs','tsx','--version'],{stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',data=>{output+=data;});
  assert.equal((await once(child,'close'))[0],0);
  assert.match(output,/tsx v\d/);
});

function fakeChild(){const child=new EventEmitter();child.killed=[];child.kill=signal=>{child.killed.push(signal);return true;};return child;}
test('development launch failures are handled and stop the other service',()=>{
  const errors=[],codes=[];
  const running=[fakeChild(),fakeChild()];let index=0;
  startDevelopment({spawnCommand:()=>running[index++],onError:message=>errors.push(message),onExit:code=>codes.push(code)});
  running[0].emit('error',new Error('spawn npm ENOENT'));
  assert.deepEqual(codes,[1]);assert.deepEqual(errors,['spawn npm ENOENT']);
  assert.deepEqual(running[1].killed,['SIGTERM']);
  running[1].emit('exit',0);assert.deepEqual(codes,[1]);
});

test('development preserves failing exit status and stops sibling only once',()=>{
  const children=[fakeChild(),fakeChild()],codes=[];let index=0;
  const stop=startDevelopment({spawnCommand:()=>children[index++],onExit:code=>codes.push(code)});
  children[0].emit('exit',23);stop();children[1].emit('exit',0);
  assert.deepEqual(codes,[23]);assert.deepEqual(children[1].killed,['SIGTERM']);
});
