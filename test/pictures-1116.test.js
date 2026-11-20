// 2026-11-16: pictures reach the summarizer only as placeholders; her own description right after viewing is kept.
import test from 'node:test';import assert from 'node:assert/strict';
import {pictureRule,conversationGuidance} from '../chat-scope.js';
import {selectionInstructions} from '../conversation-selection.js';
test('chat guidance (normal and rolling) carries the picture rule; selection keeps her description',()=>{
 assert.ok(conversationGuidance.endsWith(pictureRule));
 assert.match(pictureRule,/\[图片1\]/);assert.match(pictureRule,/获取失败/);assert.match(pictureRule,/Never invent/);
 assert.match(selectionInstructions,/her own description of it together with that image result/);
});
