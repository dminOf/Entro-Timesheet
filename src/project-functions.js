import {EntroError} from './client.js';

export class FunctionError extends Error {constructor(message,status=400){super(message);this.name='FunctionError';this.status=status;}}
const ALL={add:true,edit:true,remove:true};
async function readAll(read){
  const rows=[];
  for(let page=1;page<=50;page++){
    const result=await read(page);
    const data=Array.isArray(result.resultData)?result.resultData:[];
    rows.push(...data);
    if(data.length<100||rows.length>=Number(result.recordsTotal??rows.length))return rows;
  }
  throw new EntroError('Unable to load the complete list.');
}
async function snapshot(client){
  const [functions,projects]=await Promise.all([
    readAll(page=>client.projectFunctions({page,pageSize:100})),
    readAll(page=>client.favoriteProjects({isActive:'Y',page,pageSize:100})),
  ]);
  return {functions:functions.filter(f=>f.isActive!=='N'),projects};
}
const same=(a,b)=>String(a??'').trim().toLowerCase()===String(b??'').trim().toLowerCase();
// Function and project IDs already reach the entry page; audit fields stay on the server.
function present({functions,projects},permissions){
  return {permissions,
    functions:functions.map(f=>({id:String(f.projectFunctionId),projectId:String(f.projectId),projectName:String(f.projectName??''),name:String(f.functionDesc??''),code:String(f.functionCode??''),status:f.status==='Inactive'?'Inactive':'Active'}))
      .sort((a,b)=>a.projectName.localeCompare(b.projectName)||a.name.localeCompare(b.name)),
    projects:projects.map(p=>({id:String(p.projectId),name:String(p.projectName??'Unnamed project')})).sort((a,b)=>a.name.localeCompare(b.name))};
}
function fields(input){
  const name=typeof input.name==='string'?input.name.trim():'',code=typeof input.code==='string'?input.code.trim():'';
  if(typeof input.projectId!=='string'||!/^[\w.-]{1,100}$/.test(input.projectId))throw new FunctionError('Choose a project.');
  if(!name||name.length>250)throw new FunctionError('Enter a function name of up to 250 characters.');
  if(code.length>50)throw new FunctionError('Use a function code of up to 50 characters.');
  if(!['Active','Inactive'].includes(input.status))throw new FunctionError('Choose Active or Inactive.');
  return {projectId:input.projectId,name,code,status:input.status};
}

export function createFunctionService(){
  let busy=false;
  return {
    async options(client,{permissions=ALL}={}){return present(await snapshot(client),permissions);},
    /** Validates against fresh portal reads. Preview unless dryRun is false; never retries. */
    async change(client,input,{dryRun=true,permissions=ALL}={}){
      if(!input||!['create','update','remove'].includes(input.action))throw new FunctionError('Choose an action.');
      const allowed={create:permissions.add,update:permissions.edit,remove:permissions.remove}[input.action];
      if(!allowed)throw new FunctionError('Your portal permissions do not allow this change.',403);
      if(input.action!=='create'&&(typeof input.id!=='string'||!/^[\w.-]{1,100}$/.test(input.id)))throw new FunctionError('Choose a function.');
      const wanted=input.action==='remove'?null:fields(input);
      if(busy)throw new FunctionError('Another function change is still running. Try again shortly.',409);
      busy=true;
      try{
        const current=await snapshot(client);
        const existing=input.action==='create'?null:current.functions.find(f=>String(f.projectFunctionId)===input.id);
        if(input.action!=='create'&&!existing)throw new FunctionError('This function no longer exists. Reload the list.',404);
        let request,method,verb;
        if(input.action==='remove'){request={projectFunctionId:existing.projectFunctionId};method='removeProjectFunction';verb='Removed';}
        else{
          // An edited function may stay on a project that is no longer a favorite.
          const project=current.projects.find(p=>String(p.projectId)===wanted.projectId)??(existing&&String(existing.projectId)===wanted.projectId?{projectId:existing.projectId,projectName:existing.projectName}:null);
          if(!project)throw new FunctionError('Choose one of your favorite projects.',404);
          if(current.functions.some(f=>f!==existing&&String(f.projectId)===wanted.projectId&&same(f.functionDesc,wanted.name)))throw new FunctionError('This project already has a function with that name.',409);
          if(existing&&String(existing.projectId)===wanted.projectId&&String(existing.functionDesc??'').trim()===wanted.name&&String(existing.functionCode??'').trim()===wanted.code&&(existing.status==='Inactive'?'Inactive':'Active')===wanted.status)throw new FunctionError('There are no changes to save.');
          request={projectFunctionId:existing?.projectFunctionId,projectId:project.projectId,projectName:project.projectName,functionDesc:wanted.name,functionCode:wanted.code||null,status:wanted.status};
          [method,verb]=existing?['updateProjectFunction','Updated']:['createProjectFunction','Added'];
        }
        if(dryRun)return await client[method](request,{dryRun:true});
        try{await client[method](request,{dryRun:false});}
        catch(error){
          // A decoded portal answer is a rejection; anything else may still have been applied.
          if(error instanceof EntroError&&(error.resultCode!=null||(error.status>=400&&error.status<500)))throw new FunctionError('The portal did not accept this change.',502);
          throw new FunctionError('The result is unclear. Reload functions to check before trying again.',502);
        }
        const message=`${verb} ${wanted?.name??String(existing.functionDesc??'function')}.`;
        try{return {...present(await snapshot(client),permissions),message};}
        catch{return {message:message+' Reload to see the updated list.'};}
      }finally{busy=false;}
    },
  };
}
export const projectFunctions=createFunctionService();
