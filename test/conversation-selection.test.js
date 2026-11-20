import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationSegments,selectConversation} from '../conversation-selection.js';
import {chatScope} from '../chat-scope.js';
test('selection preserves exact retained source, uncertainty and complete coverage',()=>{
 const rows=conversationSegments('甲'.repeat(4000)+'\n青枔说不要再提这件事。');
 assert.equal(rows.map(x=>x.text).join(''),'甲'.repeat(4000)+'\n青枔说不要再提这件事。');
 const decisions=rows.map((x,i)=>({id:x.id,action:i?'uncertain':'discard',reason:'内容取舍'}));
 assert.equal(selectConversation(rows,{decisions}).content,rows[1].text);
 assert.throws(()=>selectConversation(rows,{decisions:decisions.slice(1)}),/incomplete/);
 assert.throws(()=>selectConversation(rows,{decisions:[...decisions,decisions[0]]}),/invalid/);
});
test('engine-generated child lane inherits only its configured conversation scope',()=>{
 const p={enabled:true,sessionIds:['session-abc']};
 assert.equal(chatScope('session-abc|sub:1234',p,[]).mode,'conversation');
 assert.equal(chatScope('session-other|sub:1234',p,[]),null);
});

test('omitted spans cannot join unrelated source text into invented evidence',()=>{
 const rows=[{id:'s0',text:'已发送'},{id:'s1',text:'内部规则'},{id:'s2',text:'成功'}];
 const out=selectConversation(rows,{decisions:rows.map((r,i)=>({id:r.id,action:i===1?'discard':'keep',reason:'来源'}))});
 assert.ok(!out.content.includes('已发送成功'));assert.match(out.content,/separate source spans/);
 const full=selectConversation(rows,{decisions:rows.map(r=>({id:r.id,action:'keep',reason:'保留'}))});assert.equal(full.content,'已发送内部规则成功');
});
