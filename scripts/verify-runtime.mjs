import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const requiredFiles = [
  'server.js','package.json','package-lock.json','.env.example','public/index.html',
  'public/js/app-runtime.js','public/js/auth-client.js','public/js/auth.js','public/js/home.js',
  'public/js/dashboard.js','public/js/setting.js','public/js/owner.js','public/js/reset-password.js','public/js/help.js'
];
const legacyFiles = ['login.html','home.html','dashboard.html','setting.html','owner.html','app.html','reset-password.html','help.html'];
const missing = requiredFiles.filter((f)=>!fs.existsSync(path.join(root,f)));
const legacyPresent = legacyFiles.filter((f)=>fs.existsSync(path.join(root,'public','html',f)) || fs.existsSync(path.join(root,'public',f)));
if (missing.length || legacyPresent.length) {
  if (missing.length) { console.error('MISSING_FILES'); missing.forEach((f)=>console.error(`- ${f}`)); }
  if (legacyPresent.length) { console.error('LEGACY_HTML_FILES_PRESENT'); legacyPresent.forEach((f)=>console.error(`- ${f}`)); }
  process.exit(1);
}

function validateHttpUrl(value) {
  const raw=String(value||'').trim(); if(!raw) return {ok:false,reason:'missing'};
  let candidate=raw; if(!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)&&/^[a-z0-9.-]+(?::\d+)?(?:\/.*)?$/i.test(candidate)) candidate=`https://${candidate}`;
  try { const u=new URL(candidate); return {ok:['http:','https:'].includes(u.protocol)&&!!u.hostname,normalized:u.toString().replace(/\/$/,'')}; } catch { return {ok:false,reason:'invalid-url'}; }
}
function readEnvFile(file){ if(!fs.existsSync(file)) return {}; const values={}; for(const rawLine of fs.readFileSync(file,'utf8').split(/\r?\n/)){const line=rawLine.trim();if(!line||line.startsWith('#'))continue;const m=line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);values[m[1]]=v;}return values;}
const exampleEnv=readEnvFile(path.join(root,'.env.example'));
const exampleUrlCheck=validateHttpUrl(exampleEnv.SUPABASE_URL||'');
if(!exampleUrlCheck.ok){console.error(`INVALID_ENV_EXAMPLE_SUPABASE_URL: ${exampleUrlCheck.reason||'invalid'}`);process.exit(1);}
const actualEnv=readEnvFile(path.join(root,'.env'));
const actualUrl=actualEnv.SUPABASE_URL||process.env.SUPABASE_URL||''; const actualCheck=validateHttpUrl(actualUrl);
let supabaseStatus='not_configured',supabaseReason=actualUrl?(actualCheck.ok?null:actualCheck.reason):'missing SUPABASE_URL in .env';
if(actualCheck.ok){const c=new AbortController();const t=setTimeout(()=>c.abort(),5000);try{await fetch(actualCheck.normalized,{signal:c.signal});supabaseStatus='connected';supabaseReason=null;}catch(e){supabaseStatus=e?.name==='AbortError'?'configured_but_unreachable':'network_error';supabaseReason=e?.name==='AbortError'?'connection-timeout':'network-error';}finally{clearTimeout(t);}}
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')); const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
for(const [name,version] of Object.entries(pkg.dependencies||{})){if(lock.packages?.['']?.dependencies?.[name]!==version){console.error(`LOCK_MISMATCH ${name}`);process.exit(1);}}
const publicSourceFiles=[]; const walk=(dir)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,e.name);if(e.isDirectory())walk(full);else if(/\.(?:js|html|css|webmanifest)$/.test(e.name))publicSourceFiles.push(full);}}; walk(path.join(root,'public'));
const forbiddenRefs=[/\/login\.html/,/\/home\.html/,/\/dashboard\.html/,/\/setting\.html/,/\/owner\.html/,/\/app\.html/];
const runtimeRefHits=[]; for(const file of publicSourceFiles){const text=fs.readFileSync(file,'utf8'); for(const re of forbiddenRefs){if(re.test(text)) runtimeRefHits.push(`${path.relative(root,file)}: ${re}`);}}
if(runtimeRefHits.length){console.error('RUNTIME_OLD_HTML_REFERENCES');runtimeRefHits.forEach(x=>console.error(`- ${x}`));process.exit(1);}
const index=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const sections=['login','home','dashboard','setting','owner','app'];
for(const v of sections){if(!new RegExp(`id=["']view-${v}["']`).test(index))throw new Error(`Missing view-${v}`);}
const ids=[...index.matchAll(/\bid=["']([^"']+)["']/g)].map(m=>m[1]);const dup=[...new Set(ids.filter((id,i)=>ids.indexOf(id)!==i))];
if(dup.length){console.error('DOM_ID_COLLISION');dup.forEach(x=>console.error(`- ${x}`));process.exit(1);}
if(!/history\.pushState\([^\n]*["']\/["']/.test(fs.readFileSync(path.join(root,'public/js/app-runtime.js'),'utf8'))) throw new Error('Missing canonical history pushState');
console.log(JSON.stringify({ok:true,canonicalUrl:'/',entryPoint:'public/index.html',legacyHtmlFilesPresent:0,runtimeOldHtmlReferences:0,domIdCollisionCount:dup.length,supabase:{status:supabaseStatus,url:actualCheck.ok?actualCheck.normalized:null,reason:supabaseReason},dependencyLockSync:true},null,2));
