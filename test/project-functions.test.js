import test from 'node:test';
import assert from 'node:assert/strict';
import {EntroClient,prepareProjectFunction} from '../src/client.js';
import {createFunctionService} from '../src/project-functions.js';
import {createLocalApi} from '../src/local-api.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status});
// Synthetic portal: one favorite project with one function, plus a removed function.
function portal({write=()=>json({resultCode:'20000'})}={}){
  const calls=[];
  const functions=[
    {projectFunctionId:'f-1',projectId:'p-alpha',projectName:'Alpha',functionCode:null,functionDesc:'Development',status:'Active',isActive:'Y',createdBy:'someone'},
    {projectFunctionId:'f-old',projectId:'p-alpha',projectName:'Alpha',functionCode:null,functionDesc:'Old',status:'Active',isActive:'N'},
  ];
  const favorites=[{projectFavoriteId:'fav-1',projectId:'p-alpha',projectName:'Alpha'}];
  const fetchImpl=async(url,opts)=>{
    url=new URL(url);calls.push({path:url.pathname,method:opts.method,body:opts.body&&JSON.parse(opts.body)});
    if(opts.method!=='GET')return write(url,opts);
    if(url.pathname.endsWith('/timesheet/project-function'))return json({resultCode:'20000',resultData:functions,recordsTotal:functions.length});
    if(url.pathname.endsWith('/timesheet/project/favorite'))return json({resultCode:'20000',resultData:favorites,recordsTotal:1});
    return json({resultCode:'40401'},404);
  };
  return {client:new EntroClient({accessToken:'test-session',userId:'user-1',fetchImpl}),calls,writes:()=>calls.filter(c=>c.method!=='GET')};
}
const add={action:'create',projectId:'p-alpha',name:'  Testing ',code:'',status:'Active'};

test('function requests match the portal contract and reject unsafe input',()=>{
  const base='https://ofs.entro-lab.com/api/v1/timesheet/project-function';
  assert.deepEqual(prepareProjectFunction('create',{projectId:'p',projectName:'P',functionDesc:' Dev ',functionCode:'',status:'Active'}),
    {method:'POST',url:base,body:{projectId:'p',projectName:'P',functionCode:null,functionDesc:'Dev',status:'Active'}});
  const update=prepareProjectFunction('update',{projectFunctionId:'f-1',projectId:'p',functionDesc:'Dev',functionCode:'D1',status:'Inactive'});
  assert.equal(update.method,'PUT');assert.equal(update.url,base+'/f-1');assert.equal(update.body.functionCode,'D1');
  assert.deepEqual(prepareProjectFunction('remove',{projectFunctionId:'f-1'}),{method:'PUT',url:base+'/f-1',body:{isActive:'N'}});
  assert.throws(()=>prepareProjectFunction('remove',{projectFunctionId:'../x'}));
  assert.throws(()=>prepareProjectFunction('create',{projectId:'p',functionDesc:' ',status:'Active'}));
  assert.throws(()=>prepareProjectFunction('create',{projectId:'p',functionDesc:'x'.repeat(251),status:'Active'}));
  assert.throws(()=>prepareProjectFunction('create',{projectId:'p',functionDesc:'Dev',status:'Deleted'}));
});

test('client function writes default to preview and accept only 20000',async()=>{
  const ok=portal();
  assert.equal((await ok.client.removeProjectFunction({projectFunctionId:'f-1'})).dryRun,true);assert.equal(ok.calls.length,0);
  const other=portal({write:()=>json({resultCode:'20001'})});
  await assert.rejects(()=>other.client.removeProjectFunction({projectFunctionId:'f-1'},{dryRun:false}));
});

test('service lists active functions and favorite projects without audit fields',async()=>{
  const options=await createFunctionService().options(portal().client);
  assert.deepEqual(options.functions,[{id:'f-1',projectId:'p-alpha',projectName:'Alpha',name:'Development',code:'',status:'Active'}]);
  assert.deepEqual(options.projects,[{id:'p-alpha',name:'Alpha'}]);
  assert.ok(!JSON.stringify(options).includes('someone'));
});

test('service validates against fresh reads before any write',async()=>{
  const service=createFunctionService();const {client,writes}=portal();
  const reject=(input,pattern)=>assert.rejects(()=>service.change(client,input,{dryRun:false}),pattern);
  await reject({...add,projectId:'p-unknown'},/favorite projects/);
  await reject({...add,name:'development'},/already has a function/);
  await reject({...add,name:''},/function name/);
  await reject({action:'update',id:'f-1',projectId:'p-alpha',name:'Development',code:'',status:'Active'},/no changes/);
  await reject({action:'update',id:'f-old',projectId:'p-alpha',name:'Renamed',code:'',status:'Active'},/no longer exists/);
  await reject({action:'remove',id:'f-missing'},/no longer exists/);
  await reject({action:'archive',id:'f-1'},/Choose an action/);
  assert.equal(writes().length,0);
  assert.equal((await service.change(client,add)).dryRun,true);assert.equal(writes().length,0);
});

test('service sends create, update and remove once each',async()=>{
  const service=createFunctionService();const {client,writes}=portal();
  assert.equal((await service.change(client,add,{dryRun:false})).message,'Added Testing.');
  await service.change(client,{action:'update',id:'f-1',projectId:'p-alpha',name:'Development',code:'DEV',status:'Inactive'},{dryRun:false});
  await service.change(client,{action:'remove',id:'f-1'},{dryRun:false});
  assert.deepEqual(writes().map(w=>[w.method,w.path]),[['POST','/api/v1/timesheet/project-function'],['PUT','/api/v1/timesheet/project-function/f-1'],['PUT','/api/v1/timesheet/project-function/f-1']]);
  assert.deepEqual(writes()[0].body,{projectId:'p-alpha',projectName:'Alpha',functionCode:null,functionDesc:'Testing',status:'Active'});
  assert.equal(writes()[1].body.functionCode,'DEV');assert.deepEqual(writes()[2].body,{isActive:'N'});
});

test('service honours portal permissions, never retries and serializes changes',async()=>{
  const {client,writes}=portal();
  await assert.rejects(()=>createFunctionService().change(client,{action:'remove',id:'f-1'},{dryRun:false,permissions:{add:true,edit:true,remove:false}}),e=>e.status===403);
  assert.equal(writes().length,0);
  const lost=portal({write:()=>{throw new TypeError('network down');}});
  await assert.rejects(()=>createFunctionService().change(lost.client,add,{dryRun:false}),/result is unclear/);
  assert.equal(lost.writes().length,1);
  let release;const gate=new Promise(resolve=>release=resolve);
  const slow=portal({write:async()=>{await gate;return json({resultCode:'20000'});}});const service=createFunctionService();
  const first=service.change(slow.client,add,{dryRun:false});await new Promise(resolve=>setTimeout(resolve,10));
  await assert.rejects(()=>service.change(slow.client,{...add,name:'Other'},{dryRun:false}),e=>e.status===409);
  release();await first;
});

test('local API guards function changes like other writes',async()=>{
  const changes=[];
  const api=createLocalApi({status:async()=>({}),functionOptions:async()=>({functions:[]}),changeFunction:async input=>{changes.push(input);return {message:'ok'};}});
  const origin='http://localhost:3000',url=origin+'/entro-login/api/functions';
  assert.equal((await api(new Request(url))).status,200);
  assert.equal((await api(new Request(url,{method:'POST',headers:{Origin:origin},body:'{}'}))).status,403);
  assert.equal((await api(new Request(url,{method:'POST',headers:{Origin:origin,'X-Entro-Local':'1'},body:'x'.repeat(2001)}))).status,400);
  assert.equal((await api(new Request(url,{method:'POST',headers:{Origin:origin,'X-Entro-Local':'1'},body:JSON.stringify(add)}))).status,200);
  assert.deepEqual(changes,[add]);
});
