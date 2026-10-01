import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function holidayYear(value){
  const year=Number(value);
  if(!Number.isInteger(year)||year<1900||year>2200)throw new Error('Choose a year from 1900 to 2200.');
  return year;
}
export function validateHolidays(rows,year){
  year=holidayYear(year);
  if(!Array.isArray(rows)||rows.length>366)throw new Error('A holiday list is required.');
  const dates=new Set();
  return rows.map(row=>{
    const date=row?.date,name=row?.name;
    if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!date.startsWith(year+'-')||
      !Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw new Error('Every holiday must have a valid date in the selected year.');
    if(typeof name!=='string'||!name.trim()||name.trim().length>250)throw new Error('Give each holiday a name of up to 250 characters.');
    if(dates.has(date))throw new Error('Only one holiday is allowed per date.');
    dates.add(date);return {date,name:name.trim()};
  }).sort((a,b)=>a.date.localeCompare(b.date));
}
export function portalHolidays(rows,year){
  const byDate=new Map();
  for(const row of rows){
    if(row.warnType!=='SPECIAL_HOLIDAY'||!String(row.warnDate).startsWith(year+'-'))continue;
    if(!byDate.has(row.warnDate))byDate.set(row.warnDate,{date:row.warnDate,name:row.holidayRemark});
  }
  return validateHolidays([...byDate.values()],year);
}
const revision=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex');
export function createHolidayMaster({directory=fileURLToPath(new URL('../.private/holidays/',import.meta.url)),seedFile=new URL('../data/public-holidays-2026.json',import.meta.url)}={}){
  let queue=Promise.resolve();
  const serial=task=>{const result=queue.then(task);queue=result.catch(()=>{});return result;};
  const pathFor=client=>{
    if(!client.userId)throw new Error('An authenticated account is required.');
    return resolve(directory,createHash('sha256').update(String(client.userId)).digest('hex')+'.json');
  };
  async function load(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return {years:{}};throw e;}}
  async function persist(path,data){
    await mkdir(directory,{recursive:true,mode:0o700});const temp=path+'.'+randomUUID()+'.tmp';
    try{await writeFile(temp,JSON.stringify(data,null,2)+'\n',{mode:0o600});await rename(temp,path);}finally{await rm(temp,{force:true});}
  }
  return {
    read(client,value){return serial(async()=>{
      const year=holidayYear(value),path=pathFor(client),data=await load(path);
      if(!data.years[year]){
        if(year===2026&&seedFile){data.years[year]=validateHolidays(JSON.parse(await readFile(seedFile,'utf8')),year);}
        else {
        let rows;
        try{rows=(await client.read('holidays',{userId:client.userId,startDate:`${year}-01-01 00:00:00`,endDate:`${year}-12-31 23:59:59`})).resultData;}
        catch(e){if(e.resultCode==='40401')rows=[];else throw e;}
        if(!Array.isArray(rows))throw new Error('The portal holiday calendar is unavailable.');
        data.years[year]=portalHolidays(rows,year);
        }
        await persist(path,data);
      }
      const holidays=validateHolidays(data.years[year],year);return {year,holidays,revision:revision(holidays)};
    });},
    save(client,input){return serial(async()=>{
      const year=holidayYear(input?.year),holidays=validateHolidays(input?.holidays,year),path=pathFor(client),data=await load(path);
      if(!data.years[year])throw new Error('Load this year before saving changes.');
      if(input.revision!==revision(validateHolidays(data.years[year],year)))throw new Error('The holiday list has changed. Reload it before saving.');
      data.years[year]=holidays;await persist(path,data);return {year,holidays,revision:revision(holidays)};
    });},
  };
}
export const holidayMaster=createHolidayMaster();
