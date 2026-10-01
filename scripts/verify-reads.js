import {EntroClient} from '../src/client.js';
const client = await EntroClient.fromStorageState('.private/session.json');
// Keep this report structural: no record values, IDs, cookies or credentials.
const now = new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Bangkok',month:'numeric',year:'numeric'}).formatToParts(new Date());
const month = Number(now.find(p=>p.type==='month').value);
const year = Number(now.find(p=>p.type==='year').value);
const queries = {
  worklogs:{userId:client.userId,month,year,page:1,pageSize:10,order:'asc'},
  checkins:{checkOutFlag:false,page:1,pageSize:10,order:'desc'},
  favoriteProjects:{isActive:'Y',pageSize:100},
  projectFunctions:{page:1,pageSize:10,order:'asc'},
  overtime:{year,month,page:1,pageSize:10,order:'asc'},
  leaveBalance:{userId:client.userId},
  leaveHistory:{page:1,pageSize:10,order:'asc'},
};
let failed=false;
for (const [resource, query] of Object.entries(queries)) {
  try {
    const response=await client.read(resource,query);
    console.log(JSON.stringify({resource,verified:true,resultCode:response.resultCode,
      filters:Object.keys(query),envelopeFields:Object.keys(response),
      dataType:Array.isArray(response.resultData)?'array':typeof response.resultData,
      itemFields:Array.isArray(response.resultData)?Object.keys(response.resultData[0]??{}):[]}));
  } catch(error) {failed=true;console.log(JSON.stringify({resource,verified:false,status:error.status,resultCode:error.resultCode}));}
}
if(failed) process.exitCode=1;
