const ORIGIN = 'https://ofs.entro-lab.com';
const paths = Object.freeze({
  worklogs: '/timesheet', checkins: '/timesheet/check-in',
  favoriteProjects: '/timesheet/project/favorite', projectFunctions: '/timesheet/project-function',
  overtime: '/timesheet/ot', leaveHistory: '/timesheet/leave',
  leaveBalance: '/timesheet/leave/remain', holidays: '/timesheet/leave/holiday',
  siteWorktime: '/timesheet/site/worktime', missingCheckins: '/timesheet/user/miss/check-in',
  menu: '/auth/menu', projectsAllStaff: '/master/projects-all/staff',
  projectsAllStaffOnsite: '/master/projects-all/staff-onsite',
});
// The portal's favorite page also treats 20001 as success.
const FAVORITE_SUCCESS = ['20000','20001','20100'];
export class EntroError extends Error {
  constructor(message, {status, resultCode} = {}) {
    super(message); this.name = 'EntroError'; this.status = status; this.resultCode = resultCode;
  }
}
/** Prepare a past check-in without authentication or network activity. */
export function preparePastCheckin(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new EntroError('A check-in entry object is required.');
  const allowed = ['checkOutFlag','specialCaseCode','status','remark','startTime','endTime','duration','reasonLate','projectCode','projectFunctionId','workDate'];
  if (Object.keys(entry).some(key=>!allowed.includes(key))) throw new EntroError('Unknown check-in field.');
  for (const field of ['projectCode','projectFunctionId']) {
    if (typeof entry[field] !== 'string' || !entry[field].trim()) throw new EntroError(`${field} is required.`);
  }
  for (const field of ['startTime','endTime']) {
    if (typeof entry[field] !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry[field])) throw new EntroError(`${field} must use HH:mm.`);
  }
  const date = entry.workDate;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) throw new EntroError('workDate must be a valid YYYY-MM-DD date.');
  if (!['string','number'].includes(typeof entry.duration) || !String(entry.duration).trim() || !Number.isFinite(Number(entry.duration)) || Number(entry.duration) <= 0) throw new EntroError('duration must be positive hours.');
  if (entry.checkOutFlag !== undefined && typeof entry.checkOutFlag !== 'boolean') throw new EntroError('checkOutFlag must be boolean.');
  if (entry.status !== undefined && entry.status !== 'pending') throw new EntroError('Only pending past check-ins are supported.');
  for (const field of ['specialCaseCode','reasonLate','remark']) {
    if (entry[field] != null && typeof entry[field] !== 'string') throw new EntroError(`${field} must be a string or null.`);
  }
  const body = {
    checkOutFlag:entry.checkOutFlag ?? true, specialCaseCode:entry.specialCaseCode ?? null,
    status:'pending', remark:entry.remark ?? '', startTime:entry.startTime, endTime:entry.endTime,
    duration:String(entry.duration), reasonLate:entry.reasonLate ?? null,
    projectCode:entry.projectCode, projectFunctionId:entry.projectFunctionId, workDate:date,
  };
  return {method:'POST',url:`${ORIGIN}/api/v1/timesheet/user/check-in`,body};
}
/** Prepare a favorite-project add or remove without authentication or network activity. */
export function prepareFavoriteProject(action, {projectId, projectCode, projectFavoriteId} = {}) {
  const id = value => (typeof value === 'string' && /^[\w.-]{1,100}$/.test(value)) || (Number.isSafeInteger(value) && value > 0);
  if (!id(projectId)) throw new EntroError('projectId is required.');
  if (projectCode != null && typeof projectCode !== 'string') throw new EntroError('projectCode must be a string.');
  const body = {projectId, ...(projectCode ? {projectCode} : {})};
  const url = `${ORIGIN}/api/v1/timesheet/project/favorite`;
  if (action === 'add') return {method:'POST',url,body};
  if (action !== 'remove') throw new EntroError('Unknown favorite action.');
  if (!id(projectFavoriteId)) throw new EntroError('projectFavoriteId is required.');
  // The portal removes a favorite by deactivating it.
  return {method:'PUT',url:`${url}/${encodeURIComponent(projectFavoriteId)}`,body:{...body,isActive:'N'}};
}
/** Prepare a project-function create, update or remove without authentication or network activity. */
export function prepareProjectFunction(action, {projectFunctionId, projectId, projectName, functionCode, functionDesc, status} = {}) {
  const id = value => typeof value === 'string' && /^[\w.-]{1,100}$/.test(value);
  const url = `${ORIGIN}/api/v1/timesheet/project-function`;
  if (!['create','update','remove'].includes(action)) throw new EntroError('Unknown project-function action.');
  if (action !== 'create' && !id(projectFunctionId)) throw new EntroError('projectFunctionId is required.');
  // The portal removes a function by deactivating it.
  if (action === 'remove') return {method:'PUT',url:`${url}/${encodeURIComponent(projectFunctionId)}`,body:{isActive:'N'}};
  if (!id(projectId)) throw new EntroError('projectId is required.');
  if (typeof functionDesc !== 'string' || !functionDesc.trim() || functionDesc.trim().length > 250) throw new EntroError('functionDesc must be 1 to 250 characters.');
  if (functionCode != null && (typeof functionCode !== 'string' || functionCode.trim().length > 50)) throw new EntroError('functionCode must be up to 50 characters.');
  if (!['Active','Inactive'].includes(status)) throw new EntroError('status must be Active or Inactive.');
  if (projectName != null && typeof projectName !== 'string') throw new EntroError('projectName must be a string.');
  const body = {projectId, projectName:projectName ?? '', functionCode:functionCode?.trim() || null, functionDesc:functionDesc.trim(), status};
  return action === 'create' ? {method:'POST',url,body} : {method:'PUT',url:`${url}/${encodeURIComponent(projectFunctionId)}`,body};
}
export class EntroClient {
  #token; #fetch;
  userId; roles;
  constructor({accessToken = process.env.ENTRO_ACCESS_TOKEN, fetchImpl = fetch, userId, roles = []} = {}) {
    this.userId = userId; this.roles = Array.isArray(roles) ? roles.filter(r => typeof r === 'string') : [];
    if (!accessToken || /[\r\n;]/.test(accessToken)) throw new EntroError('A valid ENTRO_ACCESS_TOKEN or authenticated session is required.');
    this.#token = accessToken; this.#fetch = fetchImpl;
  }
  static async fromStorageState(path, options = {}) {
    const {readFile} = await import('node:fs/promises');
    const state = JSON.parse(await readFile(path, 'utf8'));
    const cookie = state.cookies?.find(c => c.name === 'accessToken' &&
      ['ofs.entro-lab.com', '.ofs.entro-lab.com', '.entro-lab.com', 'entro-lab.com'].includes(c.domain) && c.path === '/' && c.secure);
    if (!cookie || (cookie.expires > 0 && cookie.expires <= Date.now()/1000)) throw new EntroError('Session missing or expired; log in again.');
    let user;
    try { user = JSON.parse(state.origins?.find(o=>o.origin === ORIGIN)?.localStorage?.find(v=>v.name === "currentUser")?.value ?? "null"); } catch {}
    return new EntroClient({...options, userId:user?.userId, roles:user?.roles, accessToken: cookie.value});
  }
  /** Reuse a validated local session; invoke normal browser login when needed. */
  static async connect({sessionPath = '.private/session.json', fetchImpl = fetch, ...loginOptions} = {}) {
    try {
      const client = await EntroClient.fromStorageState(sessionPath,{fetchImpl});
      await client.read('menu');
      return client;
    } catch(error) {
      // Never turn a service outage or permission error into another login attempt.
      const missingFile = error.code === 'ENOENT';
      const invalidSession = error instanceof EntroError && (error.status === 401 || error.message === 'Session missing or expired; log in again.');
      if (!missingFile && !invalidSession) throw error;
    }
    const {client} = await EntroClient.loginWithBrowser({...loginOptions,sessionPath,fetchImpl});
    return client;
  }
  static async loginWithBrowser(options = {}) {
    const {browserLogin} = await import('./browser-login.js');
    return browserLogin(options);
  }
  static async login({username = process.env.ENTRO_USERNAME, password = process.env.ENTRO_PASSWORD,
    recaptchaToken = process.env.ENTRO_RECAPTCHA_TOKEN, fetchImpl = fetch} = {}) {
    if (!username || !password || !recaptchaToken) throw new EntroError('Login requires username, password and a fresh portal reCAPTCHA token; use browser login when unavailable.');
    const response = await fetchImpl(`${ORIGIN}/api/v1/auth/login`, {
      method:'POST', redirect:'error', signal:AbortSignal.timeout(30000),
      headers:{'Content-Type':'application/json', Origin:ORIGIN, Referer:`${ORIGIN}/login`},
      body:JSON.stringify({username,password,recaptchaToken}),
    });
    const data = await decode(response);
    const cookies = response.headers.getSetCookie();
    const token = cookies.map(c=>/^accessToken=([^;]+)/.exec(c)?.[1]).find(Boolean);
    if (!token) throw new EntroError('Login returned no accessToken cookie.');
    return {client:new EntroClient({accessToken:token, fetchImpl, userId:data.resultData?.user?.userId}), user:data.resultData?.user};
  }
  async read(resource, params = {}) {
    if (!Object.hasOwn(paths, resource)) throw new EntroError('Unknown read resource.');
    const url = new URL(`${ORIGIN}/api/v1${paths[resource]}`);
    for (const [key,value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      if (!['string','number','boolean'].includes(typeof value)) throw new EntroError('Query values must be scalar.');
      url.searchParams.set(key,String(value));
    }
    const response = await this.#fetch(url, {method:'GET',redirect:'error',signal:AbortSignal.timeout(30000),
      headers:{Accept:'application/json',Cookie:`accessToken=${this.#token}`}});
    return decode(response);
  }
  /** Defaults to preview; submitting requires dryRun: false. No automatic retries. */
  async createPastCheckin(entry, {dryRun = true} = {}) {
    if (typeof dryRun !== 'boolean') throw new EntroError('dryRun must be boolean.');
    const request = preparePastCheckin(entry);
    if (dryRun) return {...request,dryRun:true};
    const response = await this.#fetch(request.url, {
      method:request.method, redirect:'error', signal:AbortSignal.timeout(30000),
      headers:{Accept:'application/json','Content-Type':'application/json',Cookie:`accessToken=${this.#token}`},
      body:JSON.stringify(request.body),
    });
    return decode(response);
  }
  /** Defaults to preview; changing favorites requires dryRun: false. No automatic retries. */
  async addFavoriteProject(project, {dryRun = true} = {}) {
    return this.#write(prepareFavoriteProject('add',project),dryRun,FAVORITE_SUCCESS);
  }
  async removeFavoriteProject(favorite, {dryRun = true} = {}) {
    return this.#write(prepareFavoriteProject('remove',favorite),dryRun,FAVORITE_SUCCESS);
  }
  /** Defaults to preview; changing functions requires dryRun: false. No automatic retries. */
  async createProjectFunction(fields, {dryRun = true} = {}) {
    return this.#write(prepareProjectFunction('create',fields),dryRun,['20000']);
  }
  async updateProjectFunction(fields, {dryRun = true} = {}) {
    return this.#write(prepareProjectFunction('update',fields),dryRun,['20000']);
  }
  async removeProjectFunction(fields, {dryRun = true} = {}) {
    return this.#write(prepareProjectFunction('remove',fields),dryRun,['20000']);
  }
  async #write(request, dryRun, success) {
    if (typeof dryRun !== 'boolean') throw new EntroError('dryRun must be boolean.');
    if (dryRun) return {...request,dryRun:true};
    const response = await this.#fetch(request.url, {
      method:request.method, redirect:'error', signal:AbortSignal.timeout(30000),
      headers:{Accept:'application/json','Content-Type':'application/json',Cookie:`accessToken=${this.#token}`},
      body:JSON.stringify(request.body),
    });
    return decode(response,success);
  }
  /** Every project the account may favorite, from the portal's role-specific list. Reads all pages. */
  async allProjects({onsite = this.roles.includes('Staff Onsite'), projectName} = {}) {
    if (!onsite && !this.userId) throw new EntroError('allProjects requires userId; use the login user.');
    const projects = [];
    for (let page = 1; page <= 50; page++) {
      const result = await this.read(onsite ? 'projectsAllStaffOnsite' : 'projectsAllStaff', {page, pageSize:100,
        sort:'projectName', order:'asc', projectName, ...(onsite ? {currentSite:'Y'} : {userId:this.userId})});
      const rows = Array.isArray(result.resultData) ? result.resultData : [];
      projects.push(...rows);
      if (rows.length < 100 || projects.length >= Number(result.recordsTotal ?? projects.length)) return projects;
    }
    throw new EntroError('Unable to load the complete project list.');
  }
  worklogs(params = {}) {
    const query = {userId:this.userId,...params};
    if (!query.userId) throw new EntroError('worklogs requires userId; use the login user or supply it explicitly.');
    return this.read('worklogs',query);
  }
  checkins(params) { return this.read('checkins',params); }
  favoriteProjects(params) { return this.read('favoriteProjects',params); }
  projectFunctions(params) { return this.read('projectFunctions',params); }
  overtime(params) { return this.read('overtime',params); }
  leaveHistory(params) { return this.read('leaveHistory',params); }
  leaveBalance(params) { return this.read('leaveBalance',params); }
}
async function decode(response, success = ['20000','20100']) {
  if (!response.ok) throw new EntroError(response.status === 401 || response.status === 403 ? 'Session expired or permission denied.' : 'Portal request failed.', {status:response.status});
  let data; try {data = await response.json();} catch {throw new EntroError('Portal returned a non-JSON response.',{status:response.status});}
  if (data.resultCode != null && !success.includes(String(data.resultCode))) {
    throw new EntroError('Portal reported an application error.', {status:response.status,resultCode:data.resultCode});
  }
  return data;
}
