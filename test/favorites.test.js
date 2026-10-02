import test from 'node:test';
import assert from 'node:assert/strict';
import {EntroClient,prepareFavoriteProject} from '../src/client.js';
import {createFavoriteService} from '../src/favorites.js';
import {createLocalApi} from '../src/local-api.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status});
// Synthetic portal: two available projects, one already a favorite.
function portal({roles=['Staff Onsite'],write=()=>json({resultCode:'20001'})}={}){
  const calls=[];
  const projects=[{projectId:'p-alpha',projectName:'Alpha'},{projectId:'p-beta',projectName:'Beta'}];
  const favorites=[{projectFavoriteId:'fav-1',projectId:'p-beta',projectName:'Beta',projectCode:null}];
  const fetchImpl=async(url,opts)=>{
    url=new URL(url);calls.push({path:url.pathname,method:opts.method,query:Object.fromEntries(url.searchParams),body:opts.body&&JSON.parse(opts.body),cookie:opts.headers.Cookie});
    if(opts.method!=='GET')return write(url,opts);
    if(url.pathname.endsWith('/timesheet/project/favorite'))return json({resultCode:'20000',resultData:favorites,recordsTotal:favorites.length});
    if(url.pathname.includes('/master/projects-all/'))return json({resultCode:'20000',resultData:projects,recordsTotal:projects.length});
    return json({resultCode:'40401'},404);
  };
  return {client:new EntroClient({accessToken:'test-session',userId:'user-1',roles,fetchImpl}),calls,writes:()=>calls.filter(c=>c.method!=='GET')};
}

test('favorite requests match the portal contract and reject unsafe identifiers',()=>{
  assert.deepEqual(prepareFavoriteProject('add',{projectId:'p-alpha'}),{method:'POST',url:'https://ofs.entro-lab.com/api/v1/timesheet/project/favorite',body:{projectId:'p-alpha'}});
  const remove=prepareFavoriteProject('remove',{projectFavoriteId:'fav-1',projectId:'p-beta',projectCode:'B1'});
  assert.equal(remove.method,'PUT');assert.equal(remove.url,'https://ofs.entro-lab.com/api/v1/timesheet/project/favorite/fav-1');
  assert.deepEqual(remove.body,{projectId:'p-beta',projectCode:'B1',isActive:'N'});
  for(const bad of ['','../x','a/b','a?b',null])assert.throws(()=>prepareFavoriteProject('add',{projectId:bad}));
  assert.throws(()=>prepareFavoriteProject('remove',{projectId:'p',projectFavoriteId:'x/../y'}));
  assert.throws(()=>prepareFavoriteProject('delete',{projectId:'p'}));
});

test('client favorite writes default to preview and accept the portal success codes',async()=>{
  const {client,writes,calls}=portal();
  const preview=await client.addFavoriteProject({projectId:'p-alpha'});
  assert.equal(preview.dryRun,true);assert.equal(calls.length,0);
  await client.addFavoriteProject({projectId:'p-alpha'},{dryRun:false});
  assert.equal(writes().length,1);assert.equal(writes()[0].cookie,'accessToken=test-session');
});

test('all projects use the role-specific list and read every page',async()=>{
  const onsite=portal();await onsite.client.allProjects();
  assert.equal(onsite.calls[0].path,'/api/v1/master/projects-all/staff-onsite');assert.equal(onsite.calls[0].query.currentSite,'Y');
  const staff=portal({roles:[]});await staff.client.allProjects();
  assert.equal(staff.calls[0].path,'/api/v1/master/projects-all/staff');assert.equal(staff.calls[0].query.userId,'user-1');
  let page=0;
  const paged=new EntroClient({accessToken:'t',roles:['Staff Onsite'],fetchImpl:async()=>{page++;return json({resultCode:'20000',recordsTotal:150,resultData:Array.from({length:page===1?100:50},(_,i)=>({projectId:'p'+page+'-'+i}))});}});
  assert.equal((await paged.allProjects()).length,150);assert.equal(page,2);
});

test('service lists only unfavorited projects without favorite record identifiers',async()=>{
  const {client}=portal();
  const options=await createFavoriteService().options(client);
  assert.deepEqual(options,{favorites:[{id:'p-beta',name:'Beta'}],available:[{id:'p-alpha',name:'Alpha'}]});
  assert.ok(!JSON.stringify(options).includes('fav-1'));
});

test('service validates against fresh reads and resolves the favorite record on the server',async()=>{
  const service=createFavoriteService();
  const {client,writes}=portal();
  await assert.rejects(()=>service.change(client,{action:'add',projectId:'p-beta'},{dryRun:false}),/already a favorite/);
  await assert.rejects(()=>service.change(client,{action:'add',projectId:'p-unknown'},{dryRun:false}),/not available/);
  await assert.rejects(()=>service.change(client,{action:'remove',projectId:'p-alpha'},{dryRun:false}),/not in your favorites/);
  await assert.rejects(()=>service.change(client,{action:'add',projectId:'../x'},{dryRun:false}),/Choose a project/);
  assert.equal(writes().length,0);
  const preview=await service.change(client,{action:'remove',projectId:'p-beta'});
  assert.equal(preview.dryRun,true);assert.equal(writes().length,0);
  const result=await service.change(client,{action:'remove',projectId:'p-beta'},{dryRun:false});
  assert.equal(writes().length,1);assert.equal(writes()[0].path,'/api/v1/timesheet/project/favorite/fav-1');
  assert.deepEqual(writes()[0].body,{projectId:'p-beta',isActive:'N'});assert.equal(result.message,'Removed Beta.');
});

test('service never retries and separates rejections from uncertain outcomes',async()=>{
  const rejected=portal({write:()=>json({resultCode:'40001'})});
  await assert.rejects(()=>createFavoriteService().change(rejected.client,{action:'add',projectId:'p-alpha'},{dryRun:false}),/did not accept/);
  assert.equal(rejected.writes().length,1);
  const lost=portal({write:()=>{throw new TypeError('network down');}});
  await assert.rejects(()=>createFavoriteService().change(lost.client,{action:'add',projectId:'p-alpha'},{dryRun:false}),/result is unclear/);
  assert.equal(lost.writes().length,1);
});

test('service serializes changes',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve);
  const {client}=portal({write:async()=>{await gate;return json({resultCode:'20000'});}});
  const service=createFavoriteService();
  const first=service.change(client,{action:'add',projectId:'p-alpha'},{dryRun:false});
  await new Promise(resolve=>setTimeout(resolve,10));
  await assert.rejects(()=>service.change(client,{action:'add',projectId:'p-alpha'},{dryRun:false}),e=>e.status===409);
  release();await first;
});

test('local API guards favorite changes like other writes',async()=>{
  const changes=[];
  const api=createLocalApi({status:async()=>({}),favoriteOptions:async()=>({favorites:[],available:[]}),changeFavorite:async input=>{changes.push(input);return {message:'ok'};}});
  const origin='http://localhost:3000',url=origin+'/entro-login/api/favorites';
  assert.equal((await api(new Request(url))).status,200);
  assert.equal((await api(new Request(url,{method:'POST',headers:{Origin:origin},body:'{}'}))).status,403);
  assert.equal((await api(new Request(url,{method:'POST',headers:{Origin:'http://evil.example','X-Entro-Local':'1'},body:'{}'}))).status,403);
  assert.equal((await api(new Request(url,{method:'POST',headers:{Origin:origin,'X-Entro-Local':'1'},body:'x'.repeat(1001)}))).status,400);
  const ok=await api(new Request(url,{method:'POST',headers:{Origin:origin,'X-Entro-Local':'1'},body:JSON.stringify({action:'add',projectId:'p-alpha'})}));
  assert.equal(ok.status,200);assert.deepEqual(changes,[{action:'add',projectId:'p-alpha'}]);
});
