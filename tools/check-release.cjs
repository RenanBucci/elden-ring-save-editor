const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const root=path.join(__dirname,'..');const excluded=new Set(['.git','node_modules','target','dist','qa','release']);
const files=[];function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(excluded.has(e.name))continue;const file=path.join(dir,e.name);if(e.isDirectory())walk(file);else files.push(file);}}walk(root);
for(const f of files){assert.ok(!/\.(sl2|co2|slot|bak|dll|exe|sqlite|jpg|jpeg|bin|dcx|bdt|bhd|tpf)$/i.test(f),'Private or generated file: '+f);if(/\.(js|jsx|rs|json|md|toml|yml|txt)$/i.test(f)){const s=fs.readFileSync(f,'utf8');assert.ok(!/gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----/.test(s),'Possible credential: '+f);assert.ok(!/[A-Za-z]:[\\/]+Users[\\/]+(?:bucci|[^\\/\s"']+)[\\/]/i.test(s),'Personal absolute path: '+f);}}
assert.equal(fs.existsSync(path.join(root,'public/icons')),false);
assert.equal(fs.existsSync(path.join(root,'Save')),false);
for(const rows of Object.values(require('../public/data/itemParams.json')))for(const row of rows)assert.equal(Object.hasOwn(row,'name'),false);
console.log('PASS: '+files.length+' public source files; no saves, game image bundles, personal paths or recognized credential patterns.');

