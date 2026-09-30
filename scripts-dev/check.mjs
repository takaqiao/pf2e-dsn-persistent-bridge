import {readdir,readFile,access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const manifest=JSON.parse(await readFile('module.json','utf8'));
for(const file of await readdir('scripts')) if(file.endsWith('.js')) {
  const result=spawnSync(process.execPath,['--check',`scripts/${file}`],{encoding:'utf8'});
  if(result.status!==0) throw new Error(result.stderr);
}
for(const language of manifest.languages) JSON.parse(await readFile(language.path,'utf8'));
for(const file of [...manifest.esmodules,...manifest.styles,...manifest.languages.map(x=>x.path)]) await access(file);
await access('assets/textures/walnut-basecolor.png');
console.log('Syntax, manifest, language files and entry points pass.');
