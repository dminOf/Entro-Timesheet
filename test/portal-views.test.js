import test from 'node:test';
import assert from 'node:assert/strict';
import {queryForView,presentView} from '../src/portal-views.js';
test('read views omit internal identifiers and audit metadata',()=>{
 const source={workDate:'2026-03-16',startTime:'08:30',duration:'8',remark:'Work',userId:'private-id',checkInId:'private-record',createdBy:'private-operator'};
 const value=presentView('checkins',{resultData:[source],recordsTotal:'1'},{page:1,pageSize:25});
 assert.equal(value.recordsTotal,1);assert.equal(value.rows[0].duration,'8');
 assert.equal(JSON.stringify(value).includes('private-'),false);
});
test('period and pagination validation bound portal requests',()=>{
 assert.throws(()=>queryForView('constructor'));
 assert.throws(()=>queryForView('worklogs',{month:13,year:2026}));
 assert.throws(()=>queryForView('checkins',{pageSize:10000}));
 assert.deepEqual(queryForView('worklogs',{month:3,year:2026,page:2,pageSize:10},'sample'),{page:2,pageSize:10,order:'asc',month:3,year:2026,userId:'sample'});
});
