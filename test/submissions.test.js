import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createSubmissionService} from '../src/submissions.js';

const entry=workDate=>({workDate,startTime:'08:30',endTime:'17:30',duration:'8',projectCode:'project',projectFunctionId:'function',remark:'Example work'});
const options=()=>({today:'2026-10-01',dates:['2026-06-02','2026-06-04','2026-06-05'],existingDates:[],holidays:[{date:'2026-06-03',name:'Holiday'}],projects:[{id:'project'}],functions:[{id:'function',projectId:'project'}]});
async function fixture(run){const directory=await mkdtemp(join(tmpdir(),'entro-submissions-'));try{await run(createSubmissionService({directory}),directory);}finally{await rm(directory,{recursive:true,force:true});}}
test('create uses the exact pending check-in payload and repeated requests never resend recorded dates',async()=>fixture(async(service,directory)=>{
  const calls=[];const client={userId:'account',async createPastCheckin(body,settings){calls.push(body);assert.equal(settings.dryRun,false);return {resultCode:'20100'};}};
  const input={requestId:randomUUID(),entries:[entry('2026-06-02'),entry('2026-06-04')]};
  const result=await service.submit(client,input,options);assert.deepEqual(result.results.map(r=>r.status),['created','created']);
  assert.deepEqual(calls[0],{...entry('2026-06-02'),status:'pending',checkOutFlag:true,specialCaseCode:null,reasonLate:null});
  assert.deepEqual(await service.submit(client,input,options),result);assert.equal(calls.length,2);
  const restarted=createSubmissionService({directory});assert.equal((await restarted.submit(client,{...input,requestId:randomUUID()},options)).results[0].status,'alreadyRecorded');assert.equal(calls.length,2);
  await assert.rejects(()=>service.submit(client,{...input,entries:[entry('2026-06-05')]},options),/changed entries/);
}));
test('preflight rejects unsafe dates and invalid entries before any portal write',async()=>fixture(async service=>{
  const client={userId:'account',createPastCheckin(){throw Error('No write should occur');}};
  for(const bad of [entry('2026-06-03'),entry('2026-06-06'),entry('2026-10-02'),entry('2026-05-20'),{...entry('2026-06-04'),projectFunctionId:'wrong'},{...entry('2026-06-04'),duration:'0.25'},{...entry('2026-06-04'),endTime:'08:00'},{...entry('2026-06-04'),remark:'x'.repeat(2001)}]){
    await assert.rejects(()=>service.submit(client,{requestId:randomUUID(),entries:[entry('2026-06-02'),bad]},options));
  }
  await assert.rejects(()=>service.submit(client,{requestId:randomUUID(),entries:[entry('2026-06-02'),entry('2026-06-02')]},options),/only once/);
  const result=await service.submit(client,{requestId:randomUUID(),entries:[entry('2026-06-02')]},()=>({...options(),dates:[],existingDates:['2026-06-02']}));assert.equal(result.results[0].status,'alreadyRecorded');
}));
test('known rejections leave only failed dates eligible for a new submission',async()=>fixture(async service=>{
  const calls=[];let reject=true;const client={userId:'account',async createPastCheckin(e){calls.push(e.workDate);if(reject&&e.workDate==='2026-06-02')throw Object.assign(Error('rejected'),{status:400});return {resultCode:'20000'};}};
  const result=await service.submit(client,{requestId:randomUUID(),entries:[entry('2026-06-02'),entry('2026-06-04')]},options);assert.deepEqual(result.results.map(r=>r.status),['failed','created']);
  reject=false;const retry=await service.submit(client,{requestId:randomUUID(),entries:[entry('2026-06-02'),entry('2026-06-04')]},options);assert.deepEqual(retry.results.map(r=>r.status),['created','alreadyRecorded']);assert.deepEqual(calls,['2026-06-02','2026-06-04','2026-06-02']);
}));
test('uncertain responses stop further writes, block resends and reconcile against history',async()=>fixture(async service=>{
  let calls=0;const client={userId:'account',async createPastCheckin(){calls++;throw Error('connection lost');}};
  const input={requestId:randomUUID(),entries:[entry('2026-06-02'),entry('2026-06-04')]};
  assert.deepEqual((await service.submit(client,input,options)).results.map(r=>r.status),['unknown','notSubmitted']);assert.equal(calls,1);
  assert.equal((await service.submit(client,{requestId:randomUUID(),entries:[entry('2026-06-02')]},options)).results[0].status,'unknown');assert.equal(calls,1);
  assert.equal((await service.submit(client,input,()=>({...options(),existingDates:['2026-06-02']}))).results[0].status,'alreadyRecorded');assert.equal(calls,1);
}));
test('concurrent requests cannot race and interrupted submissions are never resumed as writes',async()=>fixture(async(service,directory)=>{
  let release;const wait=new Promise(resolve=>{release=resolve;});const client={userId:'account',async createPastCheckin(){await wait;return {resultCode:'20000'};}};
  const input={requestId:randomUUID(),entries:[entry('2026-06-02')]};const pending=service.submit(client,input,options);
  await assert.rejects(()=>service.submit(client,{...input,requestId:randomUUID()},options),e=>e.status===409);release();await pending;
  const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');const crashed={requestId:randomUUID(),entries:[entry('2026-06-04')]};
  await writeFile(join(directory,hash('account')+'.json'),JSON.stringify({dates:{'2026-06-04':{status:'processing'}},batches:{[crashed.requestId]:{fingerprint:hash(crashed.entries),state:'processing',results:[{workDate:'2026-06-04',status:'processing'}]}}}));
  const restarted=createSubmissionService({directory});const result=await restarted.submit({...client,createPastCheckin(){throw Error('Must not resume');}},crashed,options);assert.equal(result.results[0].status,'unknown');
}));
