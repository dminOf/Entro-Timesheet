import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHolidayMaster,validateHolidays,portalHolidays} from '../src/holidays.js';

test('company calendar contains all 19 announced 2026 holidays on valid weekdays',async()=>{
  const rows=JSON.parse(await readFile(new URL('../data/public-holidays-2026.json',import.meta.url),'utf8'));
  assert.equal(validateHolidays(rows,2026).length,19);
  assert.ok(rows.every(h=>![0,6].includes(new Date(h.date).getUTCDay())));
  assert.ok(rows.find(h=>h.date==='2026-06-01').name.includes('ชดเชย'));
  assert.ok(rows.find(h=>h.date==='2026-12-07').name.includes('ชดเชย'));
});
test('holiday validation rejects duplicate dates, invalid dates and wrong years',()=>{
  for(const rows of [[{date:'2026-02-30',name:'Invalid'}],[{date:'2025-01-01',name:'Wrong year'}],[{date:'2026-01-01',name:''}],[{date:'2026-01-01',name:'A'},{date:'2026-01-01',name:'B'}]])assert.throws(()=>validateHolidays(rows,2026));
  assert.deepEqual(portalHolidays([{warnDate:'2026-01-01',warnType:'SPECIAL_HOLIDAY',holidayRemark:'New Year',siteId:'hidden'},{warnDate:'2026-01-03',warnType:'WEEKLY_DAY_OFF',holidayRemark:'Saturday'}],2026),[{date:'2026-01-01',name:'New Year'}]);
});
test('master persists local edits, detects stale saves and separates accounts',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'entro-holidays-'));
  try{
    const client={userId:'first',read:()=>{throw Error('Company calendar needs no portal request');}};
    const master=createHolidayMaster({directory});const initial=await master.read(client,2026);
    assert.equal(initial.holidays.length,19);
    const edited=[...initial.holidays,{date:'2026-06-02',name:'Additional day'}];
    const saved=await master.save(client,{...initial,holidays:edited});assert.equal(saved.holidays.length,20);
    await assert.rejects(()=>master.save(client,initial),/has changed/);
    assert.equal((await createHolidayMaster({directory}).read(client,2026)).holidays.length,20);
    assert.equal((await master.read({...client,userId:'second'},2026)).holidays.length,19);
    const restored=await master.save(client,{...saved,holidays:initial.holidays});assert.deepEqual(restored.holidays,initial.holidays);
  }finally{await rm(directory,{recursive:true,force:true});}
});
