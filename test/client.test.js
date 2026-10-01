import test from 'node:test';
import assert from 'node:assert/strict';
import {EntroClient} from '../src/client.js';
const ok = data => new Response(JSON.stringify({resultCode:'20000',resultData:data}),{status:200});
test('reads send the session cookie, encode filters and never follow redirects',async()=>{
 let request;
 const client=new EntroClient({accessToken:'test-session',fetchImpl:async(url,opts)=>{request={url,opts};return ok([]);}});
 await client.worklogs({month:10,year:2026,userId:'a b',page:1,pageSize:20,missing:null});
 assert.equal(request.url.pathname,'/api/v1/timesheet');
 assert.equal(request.url.searchParams.get('userId'),'a b');assert.equal(request.url.searchParams.has('missing'),false);
 assert.equal(request.opts.method,'GET');assert.equal(request.opts.headers.Cookie,'accessToken=test-session');assert.equal(request.opts.redirect,'error');
});
test('unknown resources and unsafe tokens cannot issue requests',async()=>{
 assert.throws(()=>new EntroClient({accessToken:'x; other=y'}));
 const client=new EntroClient({accessToken:'test',fetchImpl:()=>{throw Error('Must not request');}});
 await assert.rejects(()=>client.read('https://other.example/'));await assert.rejects(()=>client.read('constructor'));
});
test('HTTP and application errors are distinguished without leaking response contents',async()=>{
 for(const response of [new Response('private payload',{status:401}),new Response(JSON.stringify({resultCode:'40001',resultDescription:'secret'}),{status:200})]){
  const client=new EntroClient({accessToken:'test',fetchImpl:async()=>response});
  await assert.rejects(()=>client.checkins(),e=>e.name==='EntroError'&&!e.message.includes('secret')&&!e.message.includes('private'));
 }
});
test('login extracts HttpOnly cookie and returns an authenticated client',async()=>{
 let calls=0;
 const fetchImpl=async(url,opts)=>{
  calls++;
  if(calls===1){assert.equal(opts.method,'POST');return new Response(JSON.stringify({resultCode:20000,resultData:{user:{userId:'sample'}}}),{headers:{'Set-Cookie':'accessToken=test-cookie; HttpOnly; Secure; Path=/'}});}
  assert.equal(opts.headers.Cookie,'accessToken=test-cookie');return ok([]);
 };
 const {client,user}=await EntroClient.login({username:'test',password:'test',recaptchaToken:'fresh',fetchImpl});
 assert.equal(user.userId,'sample');await client.favoriteProjects();
});
test('saved sessions supply current user and reject expired cookies',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os'); const {join}=await import('node:path');
 const dir=await mkdtemp(join(tmpdir(),'entro-test-'));const path=join(dir,'session.json');
 try {
  const state={cookies:[{name:'accessToken',value:'test-cookie',domain:'ofs.entro-lab.com',path:'/',secure:true,expires:Date.now()/1000+60}],origins:[{origin:'https://ofs.entro-lab.com',localStorage:[{name:'currentUser',value:JSON.stringify({userId:'sample'})}]}]};
  await writeFile(path,JSON.stringify(state),{mode:0o600});
  const client=await EntroClient.fromStorageState(path,{fetchImpl:async url=>{assert.equal(url.searchParams.get('userId'),'sample');return ok([]);}});
  await client.worklogs({month:10,year:2026});
  state.cookies[0].expires=1;await writeFile(path,JSON.stringify(state));
  await assert.rejects(()=>EntroClient.fromStorageState(path),/expired/);
 } finally {await rm(dir,{recursive:true,force:true});}
});
test('connect validates cached session without launching a browser',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=await mkdtemp(join(tmpdir(),'entro-connect-'));const path=join(dir,'session.json');
 try {
  await writeFile(path,JSON.stringify({cookies:[{name:'accessToken',value:'test-cookie',domain:'ofs.entro-lab.com',path:'/',secure:true,expires:Date.now()/1000+60}],origins:[]}));
  let calls=0;
  const client=await EntroClient.connect({sessionPath:path,username:'',password:'',fetchImpl:async url=>{calls++;assert.equal(url.pathname,'/api/v1/auth/menu');return ok([]);}});
  assert.ok(client instanceof EntroClient);assert.equal(calls,1);
  await assert.rejects(()=>EntroClient.connect({sessionPath:path,fetchImpl:async()=>new Response('outage',{status:503})}),e=>e.status===503);
 }finally{await rm(dir,{recursive:true,force:true});}
});
