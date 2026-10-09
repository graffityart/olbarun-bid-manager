import test from 'node:test';import assert from 'node:assert/strict';import {createSession,validSession} from '../lib/session.ts';
test('login sessions reject missing, tampered, expired and rotated secrets',async()=>{
 process.env.APP_PASSWORD='a-private-password-for-test';
 const token=await createSession();assert.equal(await validSession(token),true);
 assert.equal(await validSession(undefined),false);
 assert.equal(await validSession(token+'0'),false);
 assert.equal(await validSession('0.'+token.split('.').slice(1).join('.')),false);
 process.env.APP_PASSWORD='another-private-password-for-test';assert.equal(await validSession(token),false);
 delete process.env.APP_PASSWORD;assert.equal(await validSession(token),false);
 await assert.rejects(()=>createSession());
});
