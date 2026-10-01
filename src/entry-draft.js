import {preparePastCheckin} from './client.js';
export function missingWeekdays(dates,today) {
  return [...new Set(dates)].filter(date=>{
    if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>today)return false;
    const d=new Date(date+'T00:00:00Z');
    return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===date&&![0,6].includes(d.getUTCDay());
  }).sort();
}
export function validateDraft(entry,projects,functions) {
  const project=projects.find(p=>p.id===entry.projectCode);
  const fn=functions.find(f=>f.id===entry.projectFunctionId&&f.projectId===entry.projectCode);
  if(!project)throw new Error('Choose a project.');
  if(!fn)throw new Error('Choose a function for this project.');
  if(Number(entry.duration)>8||Number(entry.duration)*2%1!==0)throw new Error('Choose duration in half-hour increments from 0.5 to 8.');
  if(entry.endTime<=entry.startTime)throw new Error('Check-out must be after check-in.');
  return preparePastCheckin(entry).body;
}
