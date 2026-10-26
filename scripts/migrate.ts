import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';

export async function applyMigrations(databaseUrl:string):Promise<number> {
  if(!databaseUrl)throw new Error('DATABASE_URL wajib diisi untuk migrasi PostgreSQL.');
  const client=new pg.Client({connectionString:databaseUrl});
  await client.connect();
  let applied=0;
  try {
    await client.query('SELECT pg_advisory_lock(14626001)');
    await client.query('CREATE TABLE IF NOT EXISTS "_aet_migrations" (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const directory=fileURLToPath(new URL('../apps/api/prisma/migrations/',import.meta.url));
    const entries=(await readdir(directory,{withFileTypes:true})).filter(entry=>entry.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name));
    for(const entry of entries){
      const sql=await readFile(resolve(directory,entry.name,'migration.sql'),'utf8');
      const checksum=createHash('sha256').update(sql).digest('hex');
      const existing=await client.query<{checksum:string}>('SELECT checksum FROM "_aet_migrations" WHERE name=$1',[entry.name]);
      if(existing.rows.length){
        if(existing.rows[0].checksum!==checksum)throw new Error(`Migrasi ${entry.name} berubah setelah diterapkan. Pulihkan berkas asli; buat migrasi baru untuk perubahan skema.`);
        continue;
      }
      await client.query('BEGIN');
      try{
        await client.query(sql);
        await client.query('INSERT INTO "_aet_migrations" (name,checksum) VALUES ($1,$2)',[entry.name,checksum]);
        await client.query('COMMIT');
        applied++;
      }catch(error){await client.query('ROLLBACK');throw error;}
    }
    return applied;
  }finally{
    await client.query('SELECT pg_advisory_unlock(14626001)').catch(()=>undefined);
    await client.end();
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(`Migrasi PostgreSQL selesai: ${await applyMigrations(process.env.DATABASE_URL??'')} migrasi baru.`);}
  catch(error){console.error(error instanceof Error?error.message:'Migrasi gagal.');process.exitCode=1;}
}
