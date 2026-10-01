import {chromium} from 'playwright';
import {mkdir, writeFile, chmod} from 'node:fs/promises';
import {dirname} from 'node:path';
import {EntroClient, EntroError} from './client.js';

/** Let the portal obtain reCAPTCHA normally, then use HTTP for SDK calls. */
export async function browserLogin({sessionPath,
  username = process.env.ENTRO_USERNAME, password = process.env.ENTRO_PASSWORD,
  headless = true, manual = false, timeout = headless ? 60000 : 180000, readinessDelayMs = 12000,
  profilePath, fetchImpl = fetch, signal} = {}) {
  if (manual && headless) throw new EntroError('Manual login requires headless: false.');
  if (!manual && (!username || !password)) throw new EntroError('Set ENTRO_USERNAME and ENTRO_PASSWORD, or use manual browser login.');
  if (signal?.aborted) throw new EntroError('Login cancelled.');
  // A dedicated profile retains normal browser state between logins. Never use the user's personal Chrome profile.
  if (profilePath) await mkdir(profilePath,{recursive:true,mode:0o700});
  const browser = profilePath ? undefined : await chromium.launch({channel:'chrome',headless});
  let context;
  const abort = () => { void (browser ? browser.close() : context?.close())?.catch(()=>{}); };
  signal?.addEventListener('abort',abort,{once:true});
  try {
    context = profilePath ? await chromium.launchPersistentContext(profilePath,{channel:'chrome',headless}) : await browser.newContext();
    if(signal?.aborted) throw new EntroError('Login cancelled.');
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);
    await page.goto('https://ofs.entro-lab.com/login');
    // A persistent profile may already hold an authenticated session.
    const alreadyLoggedIn = new URL(page.url()).pathname.startsWith('/office-system/');
    if (!manual && !alreadyLoggedIn) {
      await page.getByPlaceholder('Enter Your Username').fill(username);
      await page.getByPlaceholder('Enter Your Password').fill(password);
      await page.waitForFunction(() => typeof grecaptcha !== 'undefined' && typeof grecaptcha.ready === 'function');
      await page.evaluate(() => new Promise(resolve => grecaptcha.ready(resolve)));
      await page.waitForTimeout(readinessDelayMs);
      const [response] = await Promise.all([
        page.waitForResponse(r=>r.url() === 'https://ofs.entro-lab.com/api/v1/auth/login' && r.request().method() === 'POST'),
        page.getByRole('button',{name:'Login',exact:true}).click(),
      ]);
      if (!response.ok() && headless) {
        const errorBody = await response.text().catch(()=> '');
        const recaptchaRejected = /recaptcha/i.test(errorBody);
        let resultCode; try {resultCode=JSON.parse(errorBody).resultCode;} catch {}
        const locked = ['40290','42901'].includes(String(resultCode)) || response.status() === 429;
        throw new EntroError(locked ? 'Portal login is rate-limited or temporarily locked; wait before trying again.' : recaptchaRejected ? 'Headless login rejected by reCAPTCHA. Use visible browser login to authenticate.' : 'Headless login was rejected by the portal.',{status:response.status(),resultCode});
      }
    }
    await page.waitForURL(url => url.origin === 'https://ofs.entro-lab.com' && url.pathname.startsWith('/office-system/'), {timeout});
    const cookies = await context.cookies('https://ofs.entro-lab.com');
    const token = cookies.find(c=>c.name === 'accessToken');
    if (!token) throw new EntroError('Portal did not create an authenticated session.');
    // Capture only the portal origin, not third-party reCAPTCHA storage.
    const state = await context.storageState();
    state.cookies = state.cookies.filter(c=>['ofs.entro-lab.com','.ofs.entro-lab.com','.entro-lab.com','entro-lab.com'].includes(c.domain));
    state.origins = state.origins.filter(o=>o.origin === 'https://ofs.entro-lab.com');
    let user;
    try {user = JSON.parse(state.origins[0]?.localStorage.find(v=>v.name === 'currentUser')?.value ?? 'null');} catch {}
    if (sessionPath) {
      await mkdir(dirname(sessionPath),{recursive:true,mode:0o700});
      await writeFile(sessionPath,JSON.stringify(state),{mode:0o600});
      await chmod(sessionPath,0o600);
    }
    return {client:new EntroClient({accessToken:token.value,userId:user?.userId,fetchImpl}),user};
  } finally {signal?.removeEventListener('abort',abort); if(browser) await browser.close(); else await context?.close();}
}
