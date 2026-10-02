import {EntroError} from './client.js';

export class FavoriteError extends Error {constructor(message,status=400){super(message);this.name='FavoriteError';this.status=status;}}
const byName=(a,b)=>a.name.localeCompare(b.name);
async function activeFavorites(client){
  const rows=[];
  for(let page=1;page<=50;page++){
    const result=await client.favoriteProjects({isActive:'Y',page,pageSize:100});
    const data=Array.isArray(result.resultData)?result.resultData:[];
    rows.push(...data);
    if(data.length<100||rows.length>=Number(result.recordsTotal??rows.length))return rows;
  }
  throw new EntroError('Unable to load the complete favorite list.');
}
async function snapshot(client){
  const [favorites,projects]=await Promise.all([activeFavorites(client),client.allProjects()]);
  return {favorites,projects};
}
// Project IDs already reach the entry page; favorite record IDs stay on the server.
function present({favorites,projects}){
  const chosen=new Set(favorites.map(f=>String(f.projectId)));
  return {favorites:favorites.map(f=>({id:String(f.projectId),name:String(f.projectName??'Unnamed project')})).sort(byName),
    available:projects.filter(p=>!chosen.has(String(p.projectId))).map(p=>({id:String(p.projectId),name:String(p.projectName??'Unnamed project')})).sort(byName)};
}

export function createFavoriteService(){
  let busy=false;
  return {
    async options(client){return present(await snapshot(client));},
    /** Validates against fresh portal reads. Preview unless dryRun is false; never retries. */
    async change(client,input,{dryRun=true}={}){
      if(!input||!['add','remove'].includes(input.action)||typeof input.projectId!=='string'||!/^[\w.-]{1,100}$/.test(input.projectId))throw new FavoriteError('Choose a project.');
      if(busy)throw new FavoriteError('Another favorite change is still running. Try again shortly.',409);
      busy=true;
      try{
        const current=await snapshot(client);
        const favorite=current.favorites.find(f=>String(f.projectId)===input.projectId);
        let request,name;
        if(input.action==='add'){
          if(favorite)throw new FavoriteError('This project is already a favorite.',409);
          const project=current.projects.find(p=>String(p.projectId)===input.projectId);
          if(!project)throw new FavoriteError('This project is not available to your account.',404);
          request={projectId:project.projectId,projectCode:project.projectCode??undefined};name=project.projectName;
        }else{
          if(!favorite)throw new FavoriteError('This project is not in your favorites.',404);
          request={projectFavoriteId:favorite.projectFavoriteId,projectId:favorite.projectId,projectCode:favorite.projectCode??undefined};name=favorite.projectName;
        }
        const method=input.action==='add'?'addFavoriteProject':'removeFavoriteProject';
        if(dryRun)return await client[method](request,{dryRun:true});
        try{await client[method](request,{dryRun:false});}
        catch(error){
          // A decoded portal answer is a rejection; anything else may still have been applied.
          if(error instanceof EntroError&&(error.resultCode!=null||(error.status>=400&&error.status<500)))throw new FavoriteError('The portal did not accept this change.',502);
          throw new FavoriteError('The result is unclear. Reload favorites to check before trying again.',502);
        }
        const message=(input.action==='add'?'Added ':'Removed ')+String(name??'project')+'.';
        try{return {...present(await snapshot(client)),message};}
        catch{return {message:message+' Reload to see the updated list.'};}
      }finally{busy=false;}
    },
  };
}
export const favorites=createFavoriteService();
