import test from 'node:test';
import assert from 'node:assert/strict';
import {EntroClient,preparePastCheckin} from '../src/client.js';
const entry={workDate:'2026-03-16',startTime:'08:30',endTime:'17:30',duration:'8',projectCode:'sample-project',projectFunctionId:'sample-function',remark:'Example work'};
test('preview needs no authentication and preserves independently selected duration',async()=>{
 const prepared=preparePastCheckin(entry);
 assert.equal(prepared.body.duration,'8'); assert.equal(prepared.body.status,'pending');
 assert.equal(prepared.body.checkOutFlag,true);assert.equal(prepared.body.specialCaseCode,null);
 const client=new EntroClient({accessToken:'test',fetchImpl:()=>{throw Error('No network allowed');}});
 assert.equal((await client.createPastCheckin(entry)).dryRun,true);
 assert.equal(JSON.stringify(prepared).includes('Cookie'),false);
});
test('explicit submission sends exact payload and cookie to the past-check-in endpoint',async()=>{
 let calls=0;
 const client=new EntroClient({accessToken:'test',fetchImpl:async(url,options)=>{
  calls++;assert.equal(url,'https://ofs.entro-lab.com/api/v1/timesheet/user/check-in');
  assert.equal(options.method,'POST');assert.equal(options.redirect,'error');
  assert.equal(options.headers.Cookie,'accessToken=test');assert.equal(options.headers['Content-Type'],'application/json');
  assert.deepEqual(JSON.parse(options.body),preparePastCheckin(entry).body);
  return new Response(JSON.stringify({resultCode:'20100',resultData:{}}));
 }});
 await client.createPastCheckin(entry,{dryRun:false});assert.equal(calls,1);
});
test('invalid fields fail before transport',async()=>{
 const client=new EntroClient({accessToken:'test',fetchImpl:()=>{throw Error('No network allowed');}});
 for(const patch of [{workDate:'2026-02-30'},{startTime:'24:30'},{endTime:'9:00'},{duration:0},{duration:Infinity},{projectCode:''},{status:'approved'},{userId:'unexpected'},{checkOutFlag:'true'}]) {
  await assert.rejects(()=>client.createPastCheckin({...entry,...patch},{dryRun:false}),e=>e.name==='EntroError');
 }
});
test('write failures surface without retrying',async()=>{
 let calls=0;const client=new EntroClient({accessToken:'test',fetchImpl:async()=>{calls++;return new Response('error',{status:500});}});
 await assert.rejects(()=>client.createPastCheckin(entry,{dryRun:false}),e=>e.status===500);assert.equal(calls,1);
});
