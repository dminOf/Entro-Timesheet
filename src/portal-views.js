// Only reader-facing fields cross the local API boundary.
export const views = Object.freeze({
  checkins:{title:'Check-in history',description:'Check-in and check-out records for your account.',columns:[['workDate','Date','date'],['startTime','Check-in','time'],['endTime','Check-out','time'],['duration','Hours','number'],['checkOutFlag','Checked out','boolean'],['status','Status','status'],['remark','Description','text']]},
  worklogs:{title:'Work logs',description:'Work recorded for the selected month.',period:true,columns:[['workDate','Date','date'],['projectName','Project','text'],['functionDesc','Function','text'],['startTime','Start','time'],['endTime','End','time'],['duration','Hours','number'],['detail','Description','text']]},
  favoriteProjects:{title:'Favorite projects',description:'Projects selected for your timesheet account.',columns:[['projectCode','Project code','text'],['projectName','Project','text'],['isActive','Active','boolean']]},
  projectFunctions:{title:'Project functions',description:'Functions available for your projects.',columns:[['projectName','Project','text'],['functionCode','Function code','text'],['functionDesc','Function','text'],['status','Status','status'],['remark','Notes','text']]},
  overtime:{title:'Overtime',description:'Overtime entries for the selected month.',period:true,columns:[['workDate','Date','date'],['projectName','Project','text'],['startTimeOt','Start','time'],['endTimeOt','End','time'],['timesOt','Hours','number'],['status','Status','status'],['remark','Notes','text']]},
  leaveHistory:{title:'Leave requests',description:'Your leave requests and approval status.',columns:[['leaveTypeName','Type','text'],['startDate','From','date'],['endDate','To','date'],['startTime','Start','time'],['endTime','End','time'],['status','Status','status'],['reason','Reason','text'],['remark','Notes','text']]},
  leaveBalance:{title:'Leave balance',description:'Available leave under your current contract.',columns:[['contractStartDate','Contract start','date'],['contractEndDate','Contract end','date'],['leaveAmount','Leave allowance','number'],['leaveRemain','Leave remaining','number'],['sickAmount','Sick allowance','number'],['sickRemain','Sick remaining','number']]},
});
export function queryForView(resource,values={},userId) {
  if(!Object.hasOwn(views,resource))throw new Error('Unknown view.');
  const page=Number(values.page??1),pageSize=Number(values.pageSize??25);
  if(!Number.isInteger(page)||page<1||page>100000||![10,25,50,100].includes(pageSize))throw new Error('Invalid pagination.');
  let query={page,pageSize,order:resource==='checkins'?'desc':'asc'};
  if(resource==='leaveBalance')query={userId};
  if(views[resource].period){
    const month=Number(values.month),year=Number(values.year);
    if(!Number.isInteger(month)||month<1||month>12||!Number.isInteger(year)||year<1900||year>2200)throw new Error('Select a valid month and year.');
    query={...query,month,year};
    if(resource==='worklogs')query.userId=userId;
  }
  if(resource==='favoriteProjects')query.isActive='Y';
  return query;
}
export function presentView(resource,response,query) {
  const view=views[resource];
  const source=Array.isArray(response.resultData)?response.resultData:[];
  const rows=source.map(row=>Object.fromEntries(view.columns.map(([key])=>{
    const value=row[key];return [key,value==null?null:typeof value==='string'||typeof value==='number'||typeof value==='boolean'?value:null];
  })));
  const count=Number(response.recordsTotal??rows.length);
  return {title:view.title,description:view.description,period:!!view.period,
    columns:view.columns.map(([key,label,type])=>({key,label,type})),rows,
    recordsTotal:Number.isFinite(count)&&count>=0?count:rows.length,page:query.page??1,pageSize:query.pageSize??rows.length};
}
