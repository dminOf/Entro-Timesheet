import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {handleLocalApi} from './local-api.js';

const assets=new Map([
  ['', ['../local-login/page.html','text/html']],
  ['entry.html',['../local-login/entry.html','text/html']],
  ...['entry.js','entry.css','portal.css'].map(name=>[name,['../local-login/'+name,name.endsWith('.js')?'text/javascript':'text/css']]),
  ['vendor/jsuites.js',['../node_modules/jsuites/dist/jsuites.js','text/javascript']],
  ['vendor/jsuites.css',['../node_modules/jsuites/dist/jsuites.css','text/css']],
  ['vendor/jspreadsheet.js',['../node_modules/jspreadsheet-ce/dist/index.js','text/javascript']],
  ['vendor/jspreadsheet.css',['../node_modules/jspreadsheet-ce/dist/jspreadsheet.css','text/css']],
]);
const base='/entro-login/';
const headers={
  'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',
  'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};
const maxBodyBytes=100000;

// Serve only explicit public assets. Never expose the checkout or private session files.
export function createLocalServer({api=handleLocalApi}={}) {
  return createServer(async(req,res)=>{
    try {
      const port=req.socket.localPort;
      const allowedHosts=['localhost','127.0.0.1'].flatMap(host=>[host+':'+port,...(port===80?[host]:[])]);
      if(!allowedHosts.includes(req.headers.host)){
        res.writeHead(403,headers);res.end('Local access only');return;
      }
      const origin=new URL('http://'+req.headers.host).origin;
      const url=new URL(req.url,origin);
      if(url.origin!==origin){res.writeHead(403,headers);res.end('Local access only');return;}
      if(url.pathname==='/'||url.pathname==='/entro-login'){
        res.writeHead(302,{...headers,Location:base});res.end();return;
      }
      let response;
      if(url.pathname===base+'api'||url.pathname.startsWith(base+'api/')){
        // Reject writes before consuming their body, then cap it by bytes while streaming.
        if(req.method==='POST'&&(req.headers.origin!==origin||req.headers['x-entro-local']!=='1')){
          res.writeHead(403,headers);res.end('Forbidden');return;
        }
        const chunks=[];let bytes=0;
        for await(const chunk of req.iterator({destroyOnReturn:false})){
          bytes+=chunk.length;
          if(bytes>maxBodyBytes){
            req.resume();
            res.writeHead(413,{...headers,'Content-Type':'application/json'});
            res.end(JSON.stringify({error:'Request is too large.'}));return;
          }
          chunks.push(chunk);
        }
        const body=Buffer.concat(chunks);
        response=await api(new Request(url,{method:req.method,headers:req.headers,
          ...(!['GET','HEAD'].includes(req.method)&&body.length?{body}:{}),
        }));
      } else {
        const asset=url.pathname.startsWith(base)?assets.get(url.pathname.slice(base.length)):null;
        if(!asset||!['GET','HEAD'].includes(req.method)){
          res.writeHead(404,headers);res.end('Not found');return;
        }
        const [path,type]=asset;
        response=new Response(await readFile(new URL(path,import.meta.url)),{headers:{'Content-Type':type+'; charset=utf-8'}});
      }
      res.writeHead(response.status,{...headers,...Object.fromEntries(response.headers)});
      res.end(req.method==='HEAD'?undefined:Buffer.from(await response.arrayBuffer()));
    } catch {
      if(!res.headersSent)res.writeHead(500,{...headers,'Content-Type':'application/json'});
      res.end(JSON.stringify({error:'Local workspace unavailable. Check setup and try again.'}));
    }
  });
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {values}=parseArgs({options:{port:{type:'string'},help:{type:'boolean'}}});
  if(values.help){console.log('Usage: npm start -- --port 3000 (or set ENTRO_PORT)');}
  else {
    const port=Number(values.port??process.env.ENTRO_PORT??3000);
    if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Choose a port from 1 to 65535.');
    const server=createLocalServer();
    server.on('error',error=>{
      console.error(error.code==='EADDRINUSE'?'Port is already in use. Choose another with npm start -- --port 3001.':'Unable to start the local workspace.');
      process.exitCode=1;
    });
    server.listen(port,'127.0.0.1',()=>console.log(`Open http://localhost:${port}${base}`));
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close());
  }
}
