import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const destination=resolve(process.env.ENTRO_WEB_APPS_DIR || '/Users/dushyantmin/code/general/web_server/apps','entro-login');
await mkdir(destination,{recursive:true});
for(const name of ['api','index']) {
 const source=await readFile(new URL(`${name}.template.ts`,import.meta.url),'utf8');
 const moduleFile=fileURLToPath(new URL('../src/local-login.js',import.meta.url));
 const version=createHash('sha256').update(await readFile(moduleFile)).update(await readFile(new URL('../src/portal-views.js',import.meta.url))).update(await readFile(new URL('../src/entry-draft.js',import.meta.url))).update(await readFile(new URL('../src/holidays.js',import.meta.url))).update(await readFile(new URL('../src/submissions.js',import.meta.url))).digest('hex').slice(0,12);
 const modulePath=moduleFile+'?v='+version;
 const pagePath=fileURLToPath(new URL('page.html',import.meta.url));
 await writeFile(resolve(destination,`${name}.ts`),source.replace("'__SDK_MODULE__'",JSON.stringify(modulePath)).replace("'__PAGE_FILE__'",JSON.stringify(pagePath)));
}
await mkdir(resolve(destination,'vendor'),{recursive:true});
for(const name of ['entry.html','entry.js','entry.css','portal.css'])await copyFile(fileURLToPath(new URL(name,import.meta.url)),resolve(destination,name));
for(const [source,name]of [['jsuites/dist/jsuites.js','jsuites.js'],['jsuites/dist/jsuites.css','jsuites.css'],['jspreadsheet-ce/dist/index.js','jspreadsheet.js'],['jspreadsheet-ce/dist/jspreadsheet.css','jspreadsheet.css']])await copyFile(fileURLToPath(new URL('../node_modules/'+source,import.meta.url)),resolve(destination,'vendor',name));

console.log('Local login page installed. Open http://localhost:3000/entro-login/');
