import {EntroClient, EntroError, preparePastCheckin} from './client.js';
import {browserLogin} from './browser-login.js';
const [command,...args] = process.argv.slice(2);
try {
  if (command === 'login') {
    if (args.some(arg=>!['--manual','--headed','--headless'].includes(arg)) || (args.includes('--headless') && (args.includes('--manual') || args.includes('--headed')))) throw new EntroError('Use login [--headless | --headed | --manual].');
    await browserLogin({sessionPath:'.private/session.json',manual:args.includes('--manual'),headless:!args.includes('--manual') && !args.includes('--headed'),timeout:args.includes('--manual') || args.includes('--headed') ? 180000 : 60000});
    console.log('Session saved.');
  } else if (command === 'checkin-create') {
    const {readFile} = await import('node:fs/promises');
    const [file,flag,...extra] = args;
    if (!file || extra.length || (flag !== undefined && flag !== '--submit')) throw new Error('Use checkin-create entry.json [--submit].');
    const entry = JSON.parse(await readFile(file,'utf8'));
    if (flag !== '--submit') console.log(JSON.stringify({...preparePastCheckin(entry),dryRun:true},null,2));
    else {
      const client = process.env.ENTRO_ACCESS_TOKEN ? new EntroClient() : await EntroClient.fromStorageState('.private/session.json');
      console.log(JSON.stringify(await client.createPastCheckin(entry,{dryRun:false}),null,2));
    }
  } else {
    const params = Object.fromEntries(args.map(arg=>{
      const split = arg.indexOf('='); if (split < 1) throw new Error('Use key=value query arguments.');
      return [arg.slice(0,split),arg.slice(split+1)];
    }));
    const client = process.env.ENTRO_ACCESS_TOKEN ? new EntroClient() : await EntroClient.fromStorageState('.private/session.json');
    const response = command === 'worklogs' ? await client.worklogs(params) : await client.read(command,params);
    console.log(JSON.stringify(response,null,2));
  }
} catch(error) { console.error(error.name === 'EntroError' ? error.message : 'Operation failed. Check login, session and command arguments.'); process.exitCode=1; }
