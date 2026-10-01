const $=id=>document.getElementById(id);
const draftByDate=new Map();
const durations=Array.from({length:16},(_,i)=>String((i+1)/2));
let options=null,sheet=null,visibleDates=[],renderedHolidayDates=new Set(),batch=false,loading=false;
let submitting=false,reviewedEntries=[],reviewMode='create',pendingSubmission=null,lastSubmission=null,sessionAvailable=false;
const outcomes=new Map();
const locked=date=>['created','alreadyRecorded','unknown'].includes(outcomes.get(date)?.status);
const canEditDate=date=>!holidayOn(date)&&!locked(date);
const checked=value=>value===true||value===1||value==='1'||value==='true';
const displayDate=date=>date.split('-').reverse().join('/');
const weekDay=date=>new Intl.DateTimeFormat('en',{weekday:'short',timeZone:'UTC'}).format(new Date(date+'T00:00:00Z'));
const views=[['checkins','Check-in history','M8 4H5a2 2 0 0 0-2 2v14h18V6a2 2 0 0 0-2-2h-3M8 2h8v4H8zM7 11h10M7 15h6'],['worklogs','Work logs','M4 3h16v18H4zM8 7h8M8 11h8M8 15h5'],['favoriteProjects','Favorite projects','M3 7h7l2-3h9v16H3z'],['projectFunctions','Project functions','m8 6-6 6 6 6m8-12 6 6-6 6M14 4l-4 16'],['overtime','Overtime','M12 8v4l3 2M21 12a9 9 0 1 1-9-9M18 2v6m-3-3h6'],['leaveHistory','Leave requests','M4 5h16v16H4zM8 2v6M16 2v6M4 10h16M8 14h4'],['leaveBalance','Leave balance','M4 18V6M10 18v-8M16 18V3M22 18H2']];
for(const [key,label,path]of views){const button=document.createElement('button');button.innerHTML='<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="'+path+'"/></svg>';const span=document.createElement('span');span.textContent=label;button.append(span);button.onclick=()=>location.href='./?view='+key;$('navigation').append(button);}
async function request(path='',method='GET',input){
  const response=await fetch('api'+path,{method,headers:method==='POST'?{'X-Entro-Local':'1','Content-Type':'application/json'}:{},...(input===undefined?{}:{body:JSON.stringify(input)})});
  const result=await response.json();if(!response.ok){const error=Error(result.error||'Unable to load the local workspace.');error.status=response.status;throw error;}return result;
}
function setSession(s){
  sessionAvailable=s.hasSession;syncSubmitButton();
  $('name').textContent=s.account?.name||s.account?.username||'Saved account';$('role').textContent=s.account?.roles?.join(', ')||'';
  $('username').textContent=s.account?.username||'—';$('expiry').textContent=s.expiresAt?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',dateStyle:'medium',timeStyle:'short'}).format(new Date(s.expiresAt))+' (Bangkok)':'—';
  $('dot').className='dot '+(s.hasSession?'good':'bad');$('sessionLabel').textContent=s.hasSession?(s.phase==='saved'?'Verified':'Saved session'):'Login needed';$('verify').disabled=!s.hasSession;
}
async function session(){try{setSession(await request());}catch{$('sessionLabel').textContent='Unavailable';}}
$('verify').onclick=async()=>{$('verify').disabled=true;try{const s=await request('/verify','POST');setSession(s);$('sessionMessage').textContent=s.message;}catch{$('sessionMessage').textContent='Verification unavailable. Try again.';}finally{$('verify').disabled=false;}};
document.addEventListener('keydown',e=>{if(e.key==='Escape')$('session').open=false;});
function populate(select,items,placeholder){
  const previous=select.value;select.replaceChildren();
  if(placeholder){const blank=document.createElement('option');blank.value='';blank.textContent=placeholder;select.append(blank);}
  for(const item of items){const option=document.createElement('option');option.value=item.id;option.textContent=item.name;select.append(option);}
  if(items.some(item=>item.id===previous))select.value=previous;
  else if(items.length===1)select.value=items[0].id;
}
populate($('bulkDuration'),durations.map(id=>({id,name:id})));$('bulkDuration').value='8';
function populateFunctions(){populate($('bulkFunction'),options.functions.filter(f=>f.projectId===$('bulkProject').value),'Choose function');}
$('bulkProject').onchange=populateFunctions;
function entryFromRow(row,date){return {workDate:date,startTime:String(row[3]??''),endTime:String(row[4]??''),projectCode:String(row[5]??''),projectFunctionId:String(row[6]??''),duration:String(row[7]??''),remark:String(row[8]??'')};}
function problem(entry){
  if(!options.projects.some(p=>p.id===entry.projectCode))return 'Choose project';
  if(!options.functions.some(f=>f.id===entry.projectFunctionId&&f.projectId===entry.projectCode))return 'Choose function';
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.startTime)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.endTime))return 'Use HH:MM times';
  if(entry.endTime<=entry.startTime)return 'Check time range';
  if(!durations.includes(entry.duration))return 'Choose 0.5–8 hours';
  if(entry.remark.length>2000)return 'Description too long';
  return '';
}
function snapshot(){
  if(!sheet)return [];
  const rows=sheet.getData();rows.forEach((row,i)=>{if(!renderedHolidayDates.has(visibleDates[i])&&canEditDate(visibleDates[i]))draftByDate.set(visibleDates[i],[...row]);});return rows;
}
const holidayOn=date=>options?.holidays?.find(h=>h.date===date);
const editableCount=()=>visibleDates.filter(canEditDate).length;
function update(){
  if(batch||!sheet)return;
  const rows=snapshot();let selected=0,ready=0,selectedReady=0;
  rows.forEach((row,y)=>{
    const holiday=holidayOn(visibleDates[y]);
    if(holiday){
      for(let x=0;x<10;x++){const cell=sheet.getCellFromCoords(x,y);sheet.setReadOnly(cell,true);cell.closest('tr').classList.add('holiday-row');cell.title=holiday.name;}
      const checkbox=sheet.getCellFromCoords(0,y)?.querySelector('input');if(checkbox){checkbox.disabled=true;checkbox.checked=false;checkbox.setAttribute('aria-label','Public holiday: '+displayDate(visibleDates[y]));}
      sheet.getCellFromCoords(9,y).textContent='Public holiday';return;
    }
    const outcome=outcomes.get(visibleDates[y]);
    if(locked(visibleDates[y])){
      for(let x=0;x<10;x++){const cell=sheet.getCellFromCoords(x,y);sheet.setReadOnly(cell,true);cell.closest('tr').classList.add('submitted-row');cell.title=outcome.message;}
      const checkbox=sheet.getCellFromCoords(0,y)?.querySelector('input');if(checkbox){checkbox.disabled=true;checkbox.checked=false;}
      sheet.getCellFromCoords(9,y).textContent=outcome.status==='unknown'?'Check history':'Recorded';return;
    }
    const error=problem(entryFromRow(row,visibleDates[y]));const isSelected=checked(row[0]);
    if(isSelected)selected++;if(!error){ready++;if(isSelected)selectedReady++;}
    const cell=sheet.getCellFromCoords(9,y);if(cell){cell.textContent=error||(outcome?.status==='failed'?'Rejected':outcome?.status==='notSubmitted'?'Not submitted':'Ready');cell.title=outcome?.message||'';cell.classList.toggle('draft-invalid',!!error||outcome?.status==='failed');cell.classList.toggle('draft-ready',!error&&outcome?.status!=='failed');}
    const checkbox=sheet.getCellFromCoords(0,y)?.querySelector('input');if(checkbox)checkbox.setAttribute('aria-label','Select '+displayDate(visibleDates[y]));
  });
  const editable=editableCount();$('selectAllDates').disabled=!editable;$('selectAllDates').checked=!!editable&&selected===editable;$('selectAllDates').indeterminate=selected>0&&selected<editable;
  $('selectionCount').textContent=selected+' selected';$('fillSelected').disabled=!selected;$('reviewSelected').disabled=!selected;
  $('readySummary').textContent=selected?selectedReady+' of '+selected+' selected entries ready':editable?ready+' of '+editable+' entries ready · Select dates to review':'No missing entries to fill';
}
function renderMonth(){
  snapshot();visibleDates=options.calendarDates.filter(date=>date.startsWith($('entryMonth').value));
  if(sheet){jspreadsheet.destroy($('entrySpreadsheet'));sheet=null;}
  renderedHolidayDates=new Set(visibleDates.filter(date=>holidayOn(date)));
  $('entrySpreadsheet').replaceChildren();$('entrySpreadsheet').hidden=!visibleDates.length;$('entryEmpty').hidden=!!visibleDates.length;
  const editable=editableCount(),holidays=visibleDates.filter(date=>holidayOn(date)).length;
  $('missingSummary').textContent=editable+' missing '+(editable===1?'weekday':'weekdays')+(holidays?' · '+holidays+' public '+(holidays===1?'holiday':'holidays'):'');$('bulkMessage').textContent='';$('fillAll').disabled=!editable;
  $('undoEntry').disabled=!visibleDates.length;$('redoEntry').disabled=!visibleDates.length;
  if(!visibleDates.length){$('selectAllDates').checked=false;$('selectAllDates').indeterminate=false;$('selectAllDates').disabled=true;$('selectionCount').textContent='0 selected';$('readySummary').textContent='No entries to fill';$('reviewSelected').disabled=true;$('fillSelected').disabled=true;return;}
  const data=visibleDates.map(date=>holidayOn(date)?[false,displayDate(date),weekDay(date),'','','','','',holidayOn(date).name,'Public holiday']:draftByDate.get(date)||[false,displayDate(date),weekDay(date),options.defaults.startTime,options.defaults.endTime,'','',options.defaults.duration,'','Choose project']);
  const columns=[
    {type:'checkbox',title:'Select',width:48},
    {type:'text',title:'Date',width:100,readOnly:true},
    {type:'text',title:'Day',width:48,readOnly:true},
    {type:'text',title:'Check-in *',width:78},
    {type:'text',title:'Check-out *',width:82},
    {type:'dropdown',title:'Project *',width:265,source:options.projects,autocomplete:true},
    {type:'dropdown',title:'Function *',width:155,source:options.functions,autocomplete:true},
    {type:'dropdown',title:'Hours *',width:65,source:durations},
    {type:'text',title:'Description',width:280,align:'left'},
    {type:'text',title:'Validation',width:135,readOnly:true,align:'left'},
  ];
  batch=true;
  sheet=jspreadsheet($('entrySpreadsheet'),{tabs:false,toolbar:false,parseFormulas:false,parseHTML:false,contextMenu:()=>null,
    onbeforechange:(instance,cell,x,y)=>!canEditDate(visibleDates[Number(y)])?instance.getValueFromCoords(Number(x),Number(y)):undefined,
    onafterchanges:()=>update(),
    onchange:(instance,cell,x,y)=>{
      if(!batch&&Number(x)>2&&canEditDate(visibleDates[Number(y)]))outcomes.delete(visibleDates[Number(y)]);
      if(batch||Number(x)!==5)return;
      const project=instance.getValueFromCoords(5,Number(y));const compatible=options.functions.filter(f=>f.projectId===project);
      const current=instance.getValueFromCoords(6,Number(y));if(!compatible.some(f=>f.id===current)){batch=true;instance.setValueFromCoords(6,Number(y),compatible.length===1?compatible[0].id:'');batch=false;}
    },
    onundo:()=>queueMicrotask(update),onredo:()=>queueMicrotask(update),
    worksheets:[{data,columns,tableOverflow:true,tableHeight:'min(560px, 60vh)',tableWidth:'100%',freezeColumns:3,
      allowInsertColumn:false,allowInsertRow:false,allowManualInsertColumn:false,allowManualInsertRow:false,allowDeleteColumn:false,allowDeleteRow:false,allowRenameColumn:false,allowComments:false,columnSorting:false,columnDrag:false,rowDrag:false,wordWrap:false}],
  })[0];
  batch=false;update();
}
async function loadOptions(){
  if(loading)return;loading=true;$('reloadEntries').disabled=true;$('entryAlert').hidden=true;
  const current=$('entryMonth').value;
  try{
    snapshot();options=await request('/entry-options');
    const recorded=date=>['created','alreadyRecorded'].includes(outcomes.get(date)?.status);
    options.dates=options.dates.filter(date=>!recorded(date));options.calendarDates=options.calendarDates.filter(date=>holidayOn(date)||!recorded(date));
    options.holidays.forEach(h=>draftByDate.delete(h.date));populate($('bulkProject'),options.projects,'Choose project');populateFunctions();
    const months=[...new Set([...options.calendarDates.map(d=>d.slice(0,7)),options.today.slice(0,7)])].sort().reverse();
    populate($('entryMonth'),months.map(id=>({id,name:new Intl.DateTimeFormat('en',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(id+'-01T00:00:00Z'))+' · '+options.dates.filter(d=>d.startsWith(id)&&!holidayOn(d)).length+' missing'})));
    $('entryMonth').value=months.includes(current)?current:options.dates.at(-1)?.slice(0,7)||months[0];renderMonth();
  }catch(e){$('entryAlert').textContent=e.message;$('entryAlert').hidden=false;$('missingSummary').textContent='Missing dates unavailable';$('fillAll').disabled=true;}
  finally{loading=false;$('reloadEntries').disabled=false;}
}
$('entryMonth').onchange=renderMonth;$('reloadEntries').onclick=()=>{session();loadOptions();};
$('selectAllDates').onchange=()=>{const value=$('selectAllDates').checked;batch=true;sheet.getData().forEach((_,i)=>{if(canEditDate(visibleDates[i]))sheet.setValueFromCoords(0,i,value);});batch=false;update();};
function fill(selectedOnly){
  if(!sheet)return;
  const entry={startTime:$('bulkStart').value,endTime:$('bulkEnd').value,projectCode:$('bulkProject').value,projectFunctionId:$('bulkFunction').value,duration:$('bulkDuration').value,remark:$('bulkRemark').value};
  const error=problem(entry);$('entryAlert').hidden=!error;if(error){$('entryAlert').textContent=error+'. Check the fill values and try again.';return;}
  const cells=[];let count=0;
  sheet.getData().forEach((row,y)=>{if(!canEditDate(visibleDates[y])||(selectedOnly&&!checked(row[0])))return;outcomes.delete(visibleDates[y]);count++;[entry.startTime,entry.endTime,entry.projectCode,entry.projectFunctionId,entry.duration,entry.remark].forEach((value,i)=>cells.push({x:i+3,y,value}));});
  batch=true;sheet.setValue(cells);batch=false;update();$('bulkMessage').textContent='Filled '+count+' '+(count===1?'date':'dates')+'.';
}
$('fillAll').onclick=()=>fill(false);$('fillSelected').onclick=()=>fill(true);
$('undoEntry').onclick=()=>{sheet?.undo();update();};$('redoEntry').onclick=()=>{sheet?.redo();update();};
function syncSubmitButton(){
  if(!$('submitEntries'))return;
  const uncertain=reviewedEntries.some(e=>outcomes.get(e.workDate)?.status==='unknown');
  $('submitEntries').textContent=submitting?'Submitting…':pendingSubmission?'Retry / check result':reviewMode==='results'?(uncertain?'Check result':'Submitted'):'Submit '+reviewedEntries.length+' '+(reviewedEntries.length===1?'entry':'entries');
  $('submitEntries').disabled=submitting||!sessionAvailable||!options?.submissionEnabled||!reviewedEntries.length||(reviewMode==='results'?!uncertain:reviewedEntries.some(problem));
  for(const id of ['closeReview','backToEdit'])$(id).disabled=submitting;
}
function renderReview(){
  const entries=reviewedEntries,invalid=entries.filter(problem);
  $('reviewSummary').textContent=entries.length+' '+(entries.length===1?'entry':'entries')+' selected · '+entries.reduce((sum,e)=>sum+(Number(e.duration)||0),0)+' hours';
  $('reviewError').hidden=!invalid.length;$('reviewError').textContent=invalid.length+' '+(invalid.length===1?'entry needs':'entries need')+' attention. Check the Validation column before submitting.';
  $('reviewRows').replaceChildren();for(const entry of entries){const tr=document.createElement('tr');for(const value of [displayDate(entry.workDate),entry.startTime,entry.endTime,options.projects.find(p=>p.id===entry.projectCode)?.name||'Choose project',options.functions.find(f=>f.id===entry.projectFunctionId&&f.projectId===entry.projectCode)?.name||'Choose function',entry.duration,entry.remark||'—',outcomes.get(entry.workDate)?.message||'Ready to submit']){const td=document.createElement('td');td.textContent=value;tr.append(td);}$('reviewRows').append(tr);}syncSubmitButton();
}
$('reviewSelected').onclick=()=>{
  reviewMode='create';reviewedEntries=pendingSubmission?.entries||snapshot().flatMap((row,i)=>checked(row[0])&&canEditDate(visibleDates[i])?[entryFromRow(row,visibleDates[i])]:[]);renderReview();
  $('reviewActionNote').textContent=pendingSubmission?'Retry checks the earlier submission without resending recorded entries.':'Creates past check-ins with pending approval.';
  $('entryReview').showModal();
};
for(const id of ['closeReview','backToEdit'])$(id).onclick=()=>{if(!submitting)$('entryReview').close();};
$('entryReview').addEventListener('cancel',e=>{if(submitting)e.preventDefault();});
$('entryReview').addEventListener('close',()=>$('reviewSelected').focus());
$('submitEntries').onclick=async()=>{
  if(submitting||$('submitEntries').disabled)return;
  const payload=pendingSubmission||(reviewMode==='results'?lastSubmission:{requestId:crypto.randomUUID(),entries:reviewedEntries.map(e=>({...e}))});
  pendingSubmission=payload;submitting=true;syncSubmitButton();$('reviewError').hidden=true;$('reviewActionNote').textContent='Submitting selected dates. Keep this page open.';
  try{
    const result=await request('/entries','POST',payload);lastSubmission=payload;
    for(const row of result.results)outcomes.set(row.workDate,row);
    pendingSubmission=null;reviewMode='results';
    const recorded=result.results.filter(r=>['created','alreadyRecorded'].includes(r.status)).length,failed=result.results.filter(r=>r.status==='failed').length,unknown=result.results.filter(r=>r.status==='unknown').length,remaining=result.results.filter(r=>r.status==='notSubmitted').length;
    $('submissionNotice').hidden=false;$('submissionMessage').textContent=recorded+' recorded'+(failed?' · '+failed+' rejected':'')+(unknown?' · '+unknown+' need checking':'')+(remaining?' · '+remaining+' not submitted':'');
    for(const row of result.results)if(['created','alreadyRecorded'].includes(row.status)){draftByDate.delete(row.workDate);options.dates=options.dates.filter(d=>d!==row.workDate);options.calendarDates=options.calendarDates.filter(d=>d!==row.workDate);}
    renderMonth();await loadOptions();renderReview();$('reviewActionNote').textContent=unknown?'Check check-in history for unconfirmed dates. These dates are protected from repeat submission.':failed||remaining?'Recorded dates are removed. Close this dialog to review and retry the remaining dates.':'Selected dates are recorded in the portal.';
  }catch(e){
    if(e.status>=400&&e.status<500&&e.status!==409)pendingSubmission=null;
    $('reviewError').textContent=e.status?e.message:'The submission response was interrupted. Retry to check what was recorded.';$('reviewError').hidden=false;$('reviewActionNote').textContent=pendingSubmission?'Use Retry / check result to recover the earlier submission.':'Review the details and reopen this dialog before submitting.';
  }finally{submitting=false;syncSubmitButton();}
};
$('viewSubmissionResults').onclick=()=>{if(!lastSubmission)return;reviewMode='results';reviewedEntries=lastSubmission.entries;renderReview();$('reviewActionNote').textContent='Results of the last submission.';$('entryReview').showModal();};
window.addEventListener('beforeunload',e=>{if(submitting){e.preventDefault();e.returnValue='';}});

let holidayData=null,holidayDraft=[],editingDate=null,holidayBusy=false;
const holidayError=message=>{$('holidayError').textContent=message;$('holidayError').hidden=!message;};
function resetHolidayEditor(){editingDate=null;$('holidayForm').reset();$('addHoliday').textContent='Add holiday';$('cancelHolidayEdit').hidden=true;}
function holidayChanged(){return holidayData&&JSON.stringify(holidayDraft)!==JSON.stringify(holidayData.holidays);}
function renderHolidays(){
  $('holidayRows').replaceChildren();$('holidayCount').textContent=holidayDraft.length+' holidays';
  $('saveHolidays').disabled=holidayBusy||!holidayChanged();$('holidaySaveStatus').textContent=holidayChanged()?'Unsaved changes':'Changes are saved locally.';
  for(const holiday of holidayDraft){
    const tr=document.createElement('tr');for(const value of [displayDate(holiday.date),weekDay(holiday.date),holiday.name]){const td=document.createElement('td');td.textContent=value;tr.append(td);}
    const actions=document.createElement('td');actions.className='holidayactions';
    for(const [label,path,action]of [
      ['Edit','m16 3 5 5-12 12H4v-5zM14 5l5 5',()=>{editingDate=holiday.date;$('holidayDate').value=holiday.date;$('holidayName').value=holiday.name;$('addHoliday').textContent='Update holiday';$('cancelHolidayEdit').hidden=false;$('holidayName').focus();}],
      ['Remove','M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',()=>{holidayDraft=holidayDraft.filter(h=>h.date!==holiday.date);if(editingDate===holiday.date)resetHolidayEditor();renderHolidays();}],
    ]){const button=document.createElement('button');button.type='button';button.className='icon-btn';button.title=label+' holiday';button.setAttribute('aria-label',label+' holiday '+displayDate(holiday.date));button.disabled=holidayBusy;button.innerHTML='<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="'+path+'"/></svg>';button.onclick=action;actions.append(button);}
    tr.append(actions);$('holidayRows').append(tr);
  }
  if(!holidayDraft.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=4;td.className='empty';td.textContent='No public holidays for this year.';tr.append(td);$('holidayRows').append(tr);}
}
async function loadHolidayYear(){
  if(holidayBusy)return;
  const year=Number($('holidayYear').value);if(!Number.isInteger(year)||year<1900||year>2200){holidayError('Choose a year from 1900 to 2200.');return;}
  if(holidayChanged()){holidayError('Save your changes or close without saving before loading a year.');$('holidayYear').value=holidayData.year;return;}
  holidayBusy=true;$('loadHolidayYear').disabled=true;$('saveHolidays').disabled=true;$('addHoliday').disabled=true;holidayError('');
  try{holidayData=await request('/holidays?year='+year);holidayDraft=holidayData.holidays.map(h=>({...h}));resetHolidayEditor();$('holidayDate').min=year+'-01-01';$('holidayDate').max=year+'-12-31';}
  catch(e){holidayError(e.message);}
  finally{holidayBusy=false;$('loadHolidayYear').disabled=false;$('addHoliday').disabled=!holidayData;renderHolidays();}
}
$('manageHolidays').onclick=()=>{holidayData=null;holidayDraft=[];resetHolidayEditor();$('holidayYear').value=$('entryMonth').value?.slice(0,4)||'2026';$('holidayMaster').showModal();loadHolidayYear();};
$('loadHolidayYear').onclick=loadHolidayYear;
$('holidayForm').onsubmit=event=>{
  event.preventDefault();if(!holidayData||holidayBusy)return;
  const date=$('holidayDate').value,name=$('holidayName').value.trim();
  if(!name||name.length>250||!date.startsWith(holidayData.year+'-')){holidayError('Enter a date in the loaded year and a holiday name.');return;}
  if(holidayDraft.some(h=>h.date===date&&h.date!==editingDate)){holidayError('A holiday already exists on this date. Edit that holiday instead.');return;}
  holidayDraft=holidayDraft.filter(h=>h.date!==editingDate);holidayDraft.push({date,name});holidayDraft.sort((a,b)=>a.date.localeCompare(b.date));holidayError('');resetHolidayEditor();renderHolidays();
};
$('cancelHolidayEdit').onclick=resetHolidayEditor;
$('saveHolidays').onclick=async()=>{
  if(holidayBusy||!holidayChanged())return;holidayBusy=true;$('saveHolidays').disabled=true;$('addHoliday').disabled=true;$('loadHolidayYear').disabled=true;holidayError('');renderHolidays();
  try{holidayData=await request('/holidays','POST',{year:holidayData.year,holidays:holidayDraft,revision:holidayData.revision});holidayDraft=holidayData.holidays.map(h=>({...h}));await loadOptions();$('holidaySaveStatus').textContent='Holiday calendar saved.';}
  catch(e){holidayError(e.message);}
  finally{holidayBusy=false;$('addHoliday').disabled=false;$('loadHolidayYear').disabled=false;renderHolidays();}
};
for(const id of ['closeHolidays','discardHolidays'])$(id).onclick=()=>{if(!holidayBusy)$('holidayMaster').close();};
$('holidayMaster').addEventListener('cancel',e=>{if(holidayBusy)e.preventDefault();});
$('holidayMaster').addEventListener('close',()=>$('manageHolidays').focus());
session();loadOptions();setInterval(session,60000);
