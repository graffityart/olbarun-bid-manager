import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveGroup,groupRows,assertGroupSelection} from '../lib/group-scope.ts';
const rows=[{id:'other',group:'파워링크#2',selected:true,keyword:'부산철거'}, {id:'own',group:'파워링크#1_광고그룹#1',selected:true,keyword:'부산철거'}];
test('demolition group is default even when other campaign comes first',()=>{assert.equal(resolveGroup(rows,''),'파워링크#1_광고그룹#1');});
test('same keyword and selected flags in another group do not enter active scope',()=>{assert.deepEqual(groupRows(rows,resolveGroup(rows,'')).map(r=>r.id),['own']);assert.deepEqual(groupRows(rows,'파워링크#2').map(r=>r.id),['other']);});
test('stale saved group selection falls back to an existing group and empty accounts stay empty',()=>{assert.equal(resolveGroup(rows,'removed'),'파워링크#1_광고그룹#1');assert.equal(resolveGroup([],''),'');assert.deepEqual(groupRows(rows,'missing'),[]);});

test('server rejects mixed groups or missing IDs instead of executing hidden selections',()=>{
 assert.doesNotThrow(()=>assertGroupSelection(rows,['own'],'파워링크#1_광고그룹#1'));
 assert.throws(()=>assertGroupSelection(rows,['own','other'],'파워링크#1_광고그룹#1'));
 assert.throws(()=>assertGroupSelection(rows,['missing'],'파워링크#1_광고그룹#1'));
 assert.throws(()=>assertGroupSelection(rows,['own'],undefined));
});
