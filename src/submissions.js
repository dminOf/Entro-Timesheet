import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateDraft,missingWeekdays} from './entry-draft.js';

export class SubmissionError extends Error {constructor(message,status=400){super(message);this.name='SubmissionError';this.status=status;}}
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const publicResult=batch=>({state:batch.state,results:batch.results});
export function createSubmissionService({directory=fileURLToPath(new URL('../.private/submissions/',import.meta.url))}={}){
  const active=new Set();
  async function load(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return {batches:{},dates:{}};throw e;}}
  async function persist(path,data){
    await mkdir(directory,{recursive:true,mode:0o700});const temp=path+'.'+randomUUID()+'.tmp';
    try{await writeFile(temp,JSON.stringify(data)+'\n',{mode:0o600});await rename(temp,path);}finally{await rm(temp,{force:true});}
  }
  return {async submit(client,input,loadOptions){
    if(!client.userId)throw new SubmissionError('Verify your session before submitting.',401);
    if(!input||!/^[-a-f0-9]{36}$/i.test(input.requestId??'')||!Array.isArray(input.entries)||!input.entries.length||input.entries.length>31)throw new SubmissionError('Select between 1 and 31 entries.');
    const dates=input.entries.map(e=>e?.workDate);
    if(new Set(dates).size!==dates.length)throw new SubmissionError('Select each date only once.');
    const key=hash(String(client.userId)),path=resolve(directory,key+'.json'),fingerprint=hash(input.entries);
    // Claim the account before any asynchronous work so concurrent requests cannot race.
    if(active.has(key))throw new SubmissionError('A submission is still running. Check its result again shortly.',409);
    active.add(key);
    try{
      const data=await load(path),prior=data.batches[input.requestId];
      if(prior){
        if(prior.fingerprint!==fingerprint)throw new SubmissionError('Reopen review before submitting changed entries.');
        if(prior.state==='processing'){
          prior.results=prior.results.map(result=>result.status==='processing'?{...result,status:'unknown',message:'Check-in history must be checked before retrying.'}:result);
          prior.state='complete';await persist(path,data);
        }
        if(prior.results.some(r=>r.status==='unknown')){
          const options=await loadOptions(client),existing=new Set(options.existingDates);
          for(const result of prior.results)if(result.status==='unknown'&&existing.has(result.workDate)){
            result.status='alreadyRecorded';result.message='Confirmed in check-in history.';data.dates[result.workDate]={status:'created'};
          }
          await persist(path,data);
        }
        return publicResult(prior);
      }
      const options=await loadOptions(client),holidays=new Set(options.holidays.map(h=>h.date)),existing=new Set(options.existingDates),eligible=new Set(missingWeekdays(options.dates,options.today));
      const entries=input.entries.map(entry=>{
        if(typeof entry?.remark==='string'&&entry.remark.length>2000)throw new SubmissionError('Descriptions must be 2000 characters or fewer.');
        if(holidays.has(entry?.workDate)||!missingWeekdays([entry?.workDate],options.today).length)throw new SubmissionError('Holidays, weekends and future dates cannot be submitted.');
        if(!existing.has(entry.workDate)&&!eligible.has(entry.workDate))throw new SubmissionError('A selected date is no longer eligible. Refresh missing dates before submitting.');
        try{return validateDraft(entry,options.projects,options.functions);}catch(e){throw new SubmissionError(e.name==='EntroError'?'Check the entry date, times, duration and description.':e.message);}
      });
      const batch={fingerprint,state:'processing',results:entries.map(e=>({workDate:e.workDate,status:'notSubmitted',message:'Not submitted.'}))};
      data.batches[input.requestId]=batch;await persist(path,data);
      for(let i=0;i<entries.length;i++){
        const entry=entries[i],date=entry.workDate,previous=data.dates[date];
        if(existing.has(date)||previous?.status==='created'){
          batch.results[i]={workDate:date,status:'alreadyRecorded',message:'Already recorded; nothing was submitted.'};await persist(path,data);continue;
        }
        if(['processing','unknown'].includes(previous?.status)){
          batch.results[i]={workDate:date,status:'unknown',message:'An earlier attempt needs checking in check-in history.'};await persist(path,data);continue;
        }
        batch.results[i]={workDate:date,status:'processing',message:'Submitting…'};data.dates[date]={status:'processing'};await persist(path,data);
        try{
          const response=await client.createPastCheckin(entry,{dryRun:false});
          if(!['20000','20100'].includes(String(response?.resultCode)))throw new Error('Creation was not confirmed.');
          data.dates[date]={status:'created'};batch.results[i]={workDate:date,status:'created',message:'Created; pending approval.'};
        }catch(e){
          const rejected=(e.status>=400&&e.status<500)||e.resultCode!=null;
          const status=rejected?'failed':'unknown';data.dates[date]={status};
          batch.results[i]={workDate:date,status,message:rejected?(e.status===401||e.status===403?'Session expired or permission denied. Verify your session.':'The portal rejected this entry. Review its details before retrying.'):'The result could not be confirmed. Check check-in history before retrying.'};
          // Stop after an outage or authentication failure rather than issuing more writes.
          if(!rejected||e.status===401||e.status===403){await persist(path,data);break;}
        }
        await persist(path,data);
      }
      batch.state='complete';await persist(path,data);return publicResult(batch);
    }finally{active.delete(key);}
  }};
}
export const submissions=createSubmissionService();
