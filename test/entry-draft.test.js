import test from 'node:test';
import assert from 'node:assert/strict';
import {missingWeekdays,validateDraft} from '../src/entry-draft.js';

test('missing dates exclude weekends, future dates, invalid dates and duplicates',()=>{
  assert.deepEqual(missingWeekdays(['2026-03-16','2026-03-16','2026-03-14','2026-03-15','2026-03-17','2026-02-30',null,'invalid'],'2026-03-16'),['2026-03-16']);
});

test('draft requires a project and its matching function, while preserving separate work hours',()=>{
  const projects=[{id:'project'}];const functions=[{id:'function',projectId:'project'},{id:'other-function',projectId:'other-project'}];
  const entry={workDate:'2026-03-16',startTime:'08:30',endTime:'17:30',duration:'8',projectCode:'project',projectFunctionId:'function',remark:'Example work'};
  assert.deepEqual(validateDraft(entry,projects,functions),{...entry,checkOutFlag:true,specialCaseCode:null,status:'pending',reasonLate:null});
  assert.throws(()=>validateDraft({...entry,projectFunctionId:'other-function'},projects,functions),/function/);
  assert.throws(()=>validateDraft({...entry,duration:'8.5'},projects,functions),/half-hour/);
  assert.throws(()=>validateDraft({...entry,duration:'0.25'},projects,functions),/half-hour/);
  assert.throws(()=>validateDraft({...entry,endTime:'08:00'},projects,functions),/after/);
});
