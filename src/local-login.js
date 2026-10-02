import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {browserLogin} from './browser-login.js';
import {EntroClient} from './client.js';
import {queryForView,presentView} from './portal-views.js';
import {missingWeekdays} from './entry-draft.js';
import {holidayMaster} from './holidays.js';
import {submissions} from './submissions.js';
import {favorites} from './favorites.js';
import {projectFunctions} from './project-functions.js';
const sessionPath=fileURLToPath(new URL('../.private/session.json',import.meta.url));
const profilePath=fileURLToPath(new URL('../.private/local-login-profile',import.meta.url));
let state={phase:'idle',message:''};
let controller;
export async function status() {
  let expiresAt=null; let account=null;
  try {
    const saved=JSON.parse(await readFile(sessionPath,'utf8'));
    const origin=saved.origins?.find(o=>o.origin==='https://ofs.entro-lab.com');
    const user=JSON.parse(origin?.localStorage?.find(v=>v.name==='currentUser')?.value??'null');
    if(user) account={username:user.username??'',name:user.fullnameEn||user.fullnameTh||[user.firstname,user.lastname].filter(Boolean).join(' '),roles:Array.isArray(user.roles)?user.roles.filter(r=>typeof r==='string'):[]};
    const cookie=saved.cookies?.find(c=>c.name==='accessToken'&&c.domain==='ofs.entro-lab.com');
    if(cookie?.expires>0) expiresAt=new Date(cookie.expires*1000).toISOString();
  }catch{}
  return {...state,account,hasSession:!!expiresAt&&Date.parse(expiresAt)>Date.now(),expiresAt};
}
export function startLogin() {
  if(controller) return false;
  controller=new AbortController();
  state={phase:'waiting',message:'Complete login in the portal window. This page will update automatically.'};
  const signal=controller.signal;
  browserLogin({headless:false,manual:true,timeout:600000,sessionPath,profilePath,signal})
    .then(async({client})=>{
      await client.read('menu');
      state={phase:'saved',message:'Session saved and verified. You can use the SDK now.'};
    })
    .catch(()=>{state=signal.aborted?{phase:'idle',message:'Login cancelled.'}:{phase:'error',message:'Login did not complete. Open the portal again to retry.'};})
    .finally(()=>{controller=undefined;});
  return true;
}
export function cancelLogin() {controller?.abort();state={phase:'idle',message:'Login reset. Use your own browser profile to sign in.'};}
export async function verifySession() {
  try {
    const client=await EntroClient.fromStorageState(sessionPath);await client.read('menu');
    if(!controller)state={phase:'saved',message:'Saved session verified. You can use the SDK now.'};
    return true;
  }catch{
    if(!controller)state={phase:'error',message:'The saved session could not be verified. Log in again, or retry if the portal is unavailable.'};
    return false;
  }
}

export async function readPortalView(resource,values) {
  const client=await EntroClient.fromStorageState(sessionPath);
  const query=queryForView(resource,values,client.userId);
  const response=await client.read(resource,query);
  if(resource==='worklogs'&&response.resultData?.length){
    const results=await Promise.allSettled([client.favoriteProjects({pageSize:100}),client.projectFunctions({pageSize:100})]);
    const projects=results[0].status==='fulfilled'?results[0].value.resultData??[]:[];
    const functions=results[1].status==='fulfilled'?results[1].value.resultData??[]:[];
    response.resultData=response.resultData.map(row=>({...row,
      projectName:projects.find(p=>p.projectId===row.projectCode)?.projectName??'Unlisted project',
      functionDesc:functions.find(f=>f.projectFunctionId===row.projectFunctionId)?.functionDesc??'Unlisted function'}));
  }
  return presentView(resource,response,query);
}

export async function entryOptions() {
  const client=await EntroClient.fromStorageState(sessionPath);
  const {existingDates,...options}=await entryOptionsFor(client);return options;
}
async function entryOptionsFor(client) {
  const now=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const part=type=>now.find(p=>p.type===type).value;
  const today=`${part('year')}-${part('month')}-${part('day')}`;
  const [missing,projects,functions]=await Promise.all([
    client.read('missingCheckins',{userId:client.userId}),
    client.favoriteProjects({isActive:'Y',pageSize:100}),
    client.projectFunctions({pageSize:100}),
  ]);
  // Read all existing attendance pages to avoid suggesting a duplicate entry.
  const existing=new Set();let page=1,seen=0;
  for(;;){
    const result=await client.checkins({page,pageSize:100});const rows=result.resultData??[];
    rows.forEach(row=>existing.add(String(row.workDate).slice(0,10)));seen+=rows.length;
    if(rows.length<100||seen>=Number(result.recordsTotal??seen))break;
    if(page++>=1000)throw new Error('Unable to confirm all existing entry dates.');
  }
  const dates=missingWeekdays((missing.resultData??[]).map(row=>row.missing_date),today).filter(date=>!existing.has(date));
  const years=[...new Set([Number(today.slice(0,4)),...dates.map(date=>Number(date.slice(0,4)))])];
  const calendars=await Promise.all(years.map(year=>holidayMaster.read(client,year)));
  const holidays=calendars.flatMap(calendar=>calendar.holidays);
  return {dates,today,holidays,existingDates:[...existing],calendarDates:missingWeekdays([...dates,...holidays.map(h=>h.date)],today),projects:(projects.resultData??[]).map(p=>({id:p.projectId,name:p.projectName})),
    functions:(functions.resultData??[]).filter(f=>f.status==='Active'&&f.isActive!=='N').map(f=>({id:f.projectFunctionId,projectId:f.projectId,name:f.functionDesc})),
    defaults:{startTime:'08:30',endTime:'17:30',duration:'8'},submissionEnabled:true};
}

export async function submitEntries(input){return submissions.submit(await EntroClient.fromStorageState(sessionPath),input,entryOptionsFor);}

export async function favoriteOptions(){return favorites.options(await EntroClient.fromStorageState(sessionPath));}
export async function changeFavorite(input){return favorites.change(await EntroClient.fromStorageState(sessionPath),input,{dryRun:false});}

// Mirror the portal: a menu entry for the page can switch actions off; no entry leaves them on.
async function functionPermissions(){
  const saved=JSON.parse(await readFile(sessionPath,'utf8'));
  const menu=JSON.parse(saved.origins?.find(o=>o.origin==='https://ofs.entro-lab.com')?.localStorage?.find(v=>v.name==='menu')?.value??'[]');
  const item=menu.flatMap(group=>group.menuPermission??[]).find(entry=>String(entry.menuPath??'').includes('/office-system/timesheet/project-function'))?.menuPermissionItem;
  return item?{add:item.enableAdd==='Y',edit:item.enableEdit==='Y',remove:item.enableDelete==='Y'}:{add:true,edit:true,remove:true};
}
export async function functionOptions(){return projectFunctions.options(await EntroClient.fromStorageState(sessionPath),{permissions:await functionPermissions()});}
export async function changeFunction(input){return projectFunctions.change(await EntroClient.fromStorageState(sessionPath),input,{dryRun:false,permissions:await functionPermissions()});}

export async function readHolidays(year){return holidayMaster.read(await EntroClient.fromStorageState(sessionPath),year);}
export async function saveHolidays(input){return holidayMaster.save(await EntroClient.fromStorageState(sessionPath),input);}
