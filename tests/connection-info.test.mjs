import test from 'node:test';
import assert from 'node:assert/strict';
import {connectionInfo,updatedCredentials} from '../lib/connection-info.ts';
const saved={NAVER_CUSTOMER_ID:'123',NAVER_API_KEY:'private-api-key',NAVER_SECRET_KEY:'private-secret-key'};
test('only account ID and saved flags are returned to browser',()=>{assert.deepEqual(connectionInfo(saved),{customerId:'123',apiKeySaved:true,secretKeySaved:true});assert.equal(connectionInfo(null),null);assert.ok(!JSON.stringify(connectionInfo(saved)).includes('private'));});
test('blank edits retain saved keys, and an entered key replaces only that key',()=>{assert.deepEqual(updatedCredentials({customerId:'123'},saved),saved);assert.deepEqual(updatedCredentials({customerId:'123',secretKey:'replacement'},saved),{...saved,NAVER_SECRET_KEY:'replacement'});});
test('first connection and account changes require complete credentials',()=>{assert.throws(()=>updatedCredentials({customerId:'123'},null));assert.throws(()=>updatedCredentials({customerId:'456'},saved));assert.equal(updatedCredentials({customerId:'456',apiKey:'new-api',secretKey:'new-secret'},saved).NAVER_CUSTOMER_ID,'456');});
