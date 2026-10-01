import {status,cancelLogin,verifySession,readPortalView,entryOptions,readHolidays,saveHolidays,submitEntries} from '__SDK_MODULE__';
export default async function handle(req:Request) {
  const url=new URL(req.url);
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  if(!local)return new Response('Local access only',{status:403,headers});
  if(req.method==='GET'&&url.pathname.endsWith('/api'))return Response.json(await status(),{headers});
  if(req.method==='GET'&&url.pathname.endsWith('/api/holidays')){
    try{return Response.json(await readHolidays(url.searchParams.get('year')),{headers});}
    catch{return Response.json({error:'Unable to load holidays. Check the year and verify your session.'},{status:502,headers});}
  }
  if(req.method==='GET'&&url.pathname.endsWith('/api/entry-options')) {
    try{return Response.json(await entryOptions(),{headers});}
    catch{return Response.json({error:'Unable to load missing dates and projects. Verify your session and retry.'},{status:502,headers});}
  }
  if(req.method==='GET'&&url.pathname.endsWith('/api/view')) {
    try{return Response.json(await readPortalView(url.searchParams.get('resource'),Object.fromEntries(url.searchParams)),{headers});}
    catch(error:any){return Response.json({error:error.name==='EntroError'?error.message:'Unable to load this view. Check the selected filters.',needsLogin:error.status===401||error.message==='Session missing or expired; log in again.'},{status:error.name==='EntroError'?502:400,headers});}
  }
  if(req.method!=='POST')return new Response('Not found',{status:404,headers});
  if(req.headers.get('Origin')!==url.origin||req.headers.get('X-Entro-Local')!=='1')return new Response('Forbidden',{status:403,headers});
  const action=url.pathname.split('/').pop();
  if(url.pathname.endsWith('/api/entries')){
    try{
      const body=await req.text();if(body.length>100000)return Response.json({error:'Selected entries are too large.'},{status:400,headers});
      return Response.json(await submitEntries(JSON.parse(body)),{headers});
    }catch(error:any){return Response.json({error:error.name==='SubmissionError'?error.message:'Submission could not be completed. Verify your session and try again.'},{status:error.name==='SubmissionError'?error.status:502,headers});}
  }
  else if(action==='holidays'){
    try{
      const body=await req.text();if(body.length>100000)return Response.json({error:'Holiday list is too large.'},{status:400,headers});
      return Response.json(await saveHolidays(JSON.parse(body)),{headers});
    }catch(error:any){return Response.json({error:['Choose a year from 1900 to 2200.','A holiday list is required.','Every holiday must have a valid date in the selected year.','Give each holiday a name of up to 250 characters.','Only one holiday is allowed per date.','Load this year before saving changes.','The holiday list has changed. Reload it before saving.'].includes(error.message)?error.message:'Unable to save the holiday list.'},{status:400,headers});}
  }
  else if(action==='cancel')cancelLogin();
  else if(action==='verify')await verifySession();
  else return new Response('Not found',{status:404,headers});
  return Response.json(await status(),{headers});
}
