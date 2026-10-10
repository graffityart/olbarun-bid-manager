import test from 'node:test';
import assert from 'node:assert/strict';
import { reflectionRemaining } from '../lib/reflection-wait.ts';
test('reflection waits only for the remaining interval of each changed keyword',()=>{
 assert.equal(reflectionRemaining(1000,131000,180),50);
 assert.equal(reflectionRemaining(1000,201000,180),0);
 assert.equal(reflectionRemaining(1000,1000,180),180);
 assert.equal(reflectionRemaining(0,1000,180),0);
 assert.equal(reflectionRemaining(1000,180999,180),1);
});
