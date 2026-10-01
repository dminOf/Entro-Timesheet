export default async function handle(req:Request) {
  if(!['localhost','127.0.0.1','[::1]'].includes(new URL(req.url).hostname))return new Response('Local access only',{status:403});
  return new Response(await Bun.file('__PAGE_FILE__').text(),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"}});
}
