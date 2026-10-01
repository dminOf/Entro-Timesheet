import test from 'node:test';
import assert from 'node:assert/strict';
import {EntroClient} from '../src/client.js';
test('manual headless login rejects before launching a browser',async()=>{
 await assert.rejects(()=>EntroClient.loginWithBrowser({headless:true,manual:true}),/Manual login requires/);
});
test('missing credentials reject before launching a browser',async()=>{
 await assert.rejects(()=>EntroClient.loginWithBrowser({username:'',password:'',headless:true}),/Set ENTRO_USERNAME/);
});
