import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {createLocalServer} from '../src/local-server.js';
import {createLocalApi} from '../src/local-api.js';

async function workspace(t) {
  const calls=[];
  const services={
    status:async()=>({hasSession:false,account:null}),
    verifySession:async()=>calls.push('verify'),cancelLogin:()=>calls.push('cancel'),
    readPortalView:async resource=>({resource,rows:[]}),
    entryOptions:async()=>({dates:[],projects:[],functions:[]}),
    readHolidays:async()=>({holidays:[]}),saveHolidays:async input=>input,
    submitEntries:async input=>{calls.push(input);return {results:[]};},
  };
  const server=createLocalServer({api:createLocalApi(services)});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const origin='http://127.0.0.1:'+server.address().port;
  return {origin,calls};
}

test('standalone workspace serves both screens and every local dependency',async t=>{
  const {origin}=await workspace(t);
  const root=await fetch(origin+'/',{redirect:'manual'});
  assert.equal(root.status,302);assert.equal(root.headers.get('Location'),'/entro-login/');
  const files=['','entry.html','entry.js','entry.css','portal.css','vendor/jsuites.js','vendor/jsuites.css','vendor/jspreadsheet.js','vendor/jspreadsheet.css'];
  for(const file of files){
    const response=await fetch(origin+'/entro-login/'+file);
    assert.equal(response.status,200,file);
    assert.equal(response.headers.get('Cache-Control'),'no-store');
    assert.ok((await response.text()).length>100,file);
  }
  const head=await fetch(origin+'/entro-login/entry.html',{method:'HEAD'});
  assert.equal(head.status,200);assert.equal(await head.text(),'');
  const state=await fetch(origin+'/entro-login/api');
  assert.deepEqual(await state.json(),{hasSession:false,account:null});
});

test('standalone workspace never serves source, private files or arbitrary dependencies',async t=>{
  const {origin}=await workspace(t);
  for(const path of ['/.private/session.json','/entro-login/.private/session.json','/entro-login/%2e%2e/src/client.js','/entro-login/vendor/../../package.json','/entro-login/api.template.ts','/entro-login/install.js','/entro-login/vendor/playwright.js']){
    assert.equal((await fetch(origin+path)).status,404,path);
  }
  const foreignHost=await new Promise((resolve,reject)=>{
    const req=request(origin+'/entro-login/',{headers:{Host:'attacker.example'}},res=>{res.resume();resolve(res.statusCode);});
    req.on('error',reject);req.end();
  });
  assert.equal(foreignHost,403);
});

test('standalone API keeps same-origin, header, size and route guards before a write',async t=>{
  const {origin,calls}=await workspace(t);
  const url=origin+'/entro-login/api/entries';
  const headers={Origin:origin,'X-Entro-Local':'1','Content-Type':'application/json'};
  for(const h of [{},{Origin:origin},{...headers,Origin:'https://attacker.example'}]){
    assert.equal((await fetch(url,{method:'POST',headers:h,body:'{}'})).status,403);
  }
  assert.equal((await fetch(url,{method:'POST',headers,body:'x'.repeat(100001)})).status,413);
  assert.equal((await fetch(origin+'/entro-login/api/unexpected/verify',{method:'POST',headers})).status,404);
  assert.equal((await fetch(url,{method:'POST',headers,body:'invalid json'})).status,502);
  assert.deepEqual(calls,[]);
  const input={requestId:'synthetic-request',entries:[]};
  const response=await fetch(url,{method:'POST',headers,body:JSON.stringify(input)});
  assert.equal(response.status,200);assert.deepEqual(calls,[input]);
  assert.deepEqual(await response.json(),{results:[]});
});
