// 2026-11-16: summaries record what was said, not how many bubbles the character's reply used.
import test from 'node:test';import assert from 'node:assert/strict';
const {conversationGuidance,replyShapeRule}=await import('../chat-scope.js');
const {rollingRule}=await import('../runtime.js');
test('chat summaries and rolling summaries both carry the reply-shape rule',()=>{
 assert.match(replyShapeRule,/by meaning/);assert.match(replyShapeRule,/never describe message splitting/);
 assert.ok(conversationGuidance.includes(replyShapeRule));
 assert.ok(rollingRule.includes(replyShapeRule));
 assert.match(rollingRule,/do not carry message counts or layout forward/);
});
