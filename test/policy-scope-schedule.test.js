import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {scopeOf,scopeSnapshot,scopeStatus,migrateLegacyScope} from '../policy-scope.js';
import {automaticSchedule,manualBaseline,settleSchedule,week,retryDelay} from '../replay-schedule.js';
import {defaults,validateConfig} from '../runtime.js';

const c={...defaults,enabled:true};
const active=()=>({version:7,rules:['retain-identifiers'],scope:scopeOf(c),scopeDetails:scopeSnapshot(c)});

test('operational timeouts, retries, key names, context and trigger controls preserve the validated policy scope',()=>{
 const changes={timeoutMs:500000,replayTimeoutMs:3600000,retries:3,claudeKeyEnv:'ALTERNATIVE_CLAUDE_KEY',reviewKeyEnv:'ALTERNATIVE_REVIEW_KEY',
  preserveRecentTokens:32000,autoFoldTargetTokens:150000,claudeContextTokens:1200000,reviewContextTokens:1200000,
  plannerEnabled:false,plannerModel:'another-planner',plannerTimeoutMs:25000,plannerOutputTokens:4096,
  replayFeedbackEnabled:false,replayHarvestEnabled:false,enabled:false};
 for(const [key,value]of Object.entries(changes)){
  const revised={...c,[key]:value};assert.equal(scopeOf(revised),scopeOf(c),key+' must not invalidate policy');
  assert.equal(scopeStatus({active:active()},revised).status,'matched');
 }
});

test('model routes, content-stage toggles and output budgets invalidate scope with explicit changed-field evidence',()=>{
 const changes={aProvider:'another-provider',aModel:'another-reader',claudeModel:'another-claude',claudeBase:'https://claude.example.invalid/v1',
  reviewModel:'another-reviewer',reviewBase:'https://review.example.invalid/v1',verificationProvider:'openai',verificationModel:'another-verifier',
  claudeEnabled:false,reviewEnabled:false,factCheckEnabled:false,reasoningEffort:'high',maxSummaryChars:11000,
  outputTokens:18000,claudeOutputTokens:30000,reviewOutputTokens:50000,verificationOutputTokens:18000,verificationMaxFacts:20};
 for(const [key,value]of Object.entries(changes)){
  const revised={...c,[key]:value},state={active:active()};
  assert.notEqual(scopeOf(revised),scopeOf(c),key+' changes output or the content validation path');
  const status=scopeStatus(state,revised);assert.equal(status.status,'mismatch');
  assert.equal(status.storedVersion,7);assert(status.changedFields.includes(key),key+' should be explained');
  assert.match(status.reason,/旧条款仍保留/);assert.equal(state.active.version,7,'a mismatch does not discard learned clauses');
 }
});

test('settings for disabled content stages do not spuriously invalidate their current inactive scope',()=>{
 const off={...c,claudeEnabled:false,reviewEnabled:false,factCheckEnabled:false};
 for(const [key,value]of Object.entries({claudeModel:'unused',claudeBase:'https://unused.example.invalid/v1',claudeOutputTokens:30000,
  reviewOutputTokens:50000,verificationModel:'unused',verificationProvider:'openai',verificationOutputTokens:24000,verificationMaxFacts:32}))
  assert.equal(scopeOf({...off,[key]:value}),scopeOf(off),key);
});

test('only an exact legacy configuration hash migrates; unknown hashes keep clauses and visibly need verification',()=>{
 const legacyConfig={...c};delete legacyConfig.replayTimeoutMs;
 const legacy=createHash('sha256').update(JSON.stringify(Object.entries(legacyConfig)
  .filter(([key])=>!['replayFeedbackEnabled','replayHarvestEnabled'].includes(key)).sort(([a],[b])=>a.localeCompare(b)))).digest('hex');
 const before={schema:1,active:{version:4,rules:['retain-identifiers'],scope:legacy},previous:{version:3,rules:[],scope:legacy}};
 const migrated=migrateLegacyScope(before,c);
 assert.notEqual(migrated,before);assert.equal(migrated.active.scope,scopeOf(c));assert.equal(migrated.previous.scope,scopeOf(c));
 assert.deepEqual(migrated.active.scopeDetails,scopeSnapshot(c));assert.deepEqual(migrated.active.rules,before.active.rules);
 assert.equal(before.active.scope,legacy,'migration is nonmutating');assert.equal(scopeStatus(migrated,c).status,'matched');
 assert.equal(migrateLegacyScope(migrated,c),migrated,'migration is idempotent');
 const unknown={...before,active:{...before.active,scope:'unrecognized-old-config'},previous:null};
 assert.equal(migrateLegacyScope(unknown,c),unknown);const shown=scopeStatus(unknown,c);
 assert.equal(shown.status,'mismatch');assert.equal(shown.storedVersion,4);assert.deepEqual(shown.changedFields,[]);
 assert.match(shown.reason,/旧版本未保存可比较/);
 assert.equal(migrateLegacyScope(before,{...c,retries:2}),before,'cannot assume an unknown legacy config matched even for an operational field');
});

test('a first ordinary compression or failed first manual run never arms automatic calibration',()=>{
 const now=1800000000000;
 for(const initial of [{lastAttempt:null},{lastAttempt:0},{lastAttempt:now}])for(const kind of ['auto','learned']){
  const result=automaticSchedule(initial,kind,now+week*10);
  assert.equal(result.ready,false);assert.equal(result.requiresManual,true);assert.equal(result.nextAt,null);
 }
 const failed=settleSchedule({lastAttempt:now},{origin:'manual',completed:false,now});
 assert.equal(manualBaseline(failed),null);assert.equal(automaticSchedule(failed,'auto',now+week).requiresManual,true);
 const legacyFailed={last:{origin:'manual',status:'unavailable',before:{},at:now}};
 assert.equal(manualBaseline(legacyFailed),null);
});

test('completed manual calibration arms both schedules; legacy completion is accepted but automatic provenance is not',()=>{
 const now=1800000000000;
 const state=settleSchedule({lastAttempt:now},{origin:'manual',completed:true,now});
 assert.equal(manualBaseline(state),now);assert.equal(state.nextRetryAt,0);
 assert.equal(automaticSchedule(state,'auto',now).nextAt,now+week);
 assert.equal(automaticSchedule(state,'learned',now).nextAt,now+retryDelay);
 assert.equal(automaticSchedule(state,'auto',now+week).ready,true);
 assert.equal(automaticSchedule(state,'learned',now+retryDelay).ready,true);
 for(const status of ['promoted','held','unchanged'])assert.equal(manualBaseline({last:{origin:'manual',status,before:{},at:now}}),now);
 for(const origin of ['auto','learned'])assert.equal(manualBaseline({last:{origin,status:'promoted',before:{},at:now}}),null);
});

test('technical failures retry after a day rather than a new week and apply global backoff to both automatic origins',()=>{
 const now=1800000000000,baseline=now-week-1000;
 const armed={manualBaselineAt:baseline,lastCompletedAt:baseline,lastLearnedCompletedAt:baseline,lastAttempt:now};
 for(const origin of ['auto','learned']){
  const failed=settleSchedule(armed,{origin,completed:false,now});
  assert.equal(failed.lastCompletedAt,baseline);assert.equal(failed.nextRetryAt,now+retryDelay);
  for(const kind of ['auto','learned']){
   const waiting=automaticSchedule(failed,kind,now+1000);
   assert.equal(waiting.ready,false,origin+' failure must stop '+kind+' hot retry');
   assert.equal(waiting.nextAt,now+retryDelay);
   assert.equal(automaticSchedule(failed,kind,now+retryDelay).ready,true);
  }
  const locked={...failed,lease:{until:now+retryDelay+3600000}};
  assert.equal(automaticSchedule(locked,origin,now+retryDelay).ready,false);
  assert.equal(automaticSchedule(locked,origin,now).nextAt,locked.lease.until);
 }
});

test('a completed later calibration clears retry state and schedules from completion, not its starting attempt',()=>{
 const now=1800000000000,old={manualBaselineAt:now-week,lastCompletedAt:now-week,lastAttempt:now-1200000,
  nextRetryAt:now+retryDelay,retryOrigin:'auto'};
 const settled=settleSchedule(old,{origin:'auto',completed:true,now});
 assert.equal(settled.lastCompletedAt,now);assert.equal(settled.nextRetryAt,0);assert.equal(settled.retryOrigin,null);
 assert.equal(automaticSchedule(settled,'auto',now).nextAt,now+week);
});

test('full replay deadline is separately configurable from ten to sixty minutes and defaults to thirty',()=>{
 assert.equal(defaults.replayTimeoutMs,1800000);
 for(const replayTimeoutMs of [600000,1800000,3600000])assert.equal(validateConfig({...defaults,replayTimeoutMs}).replayTimeoutMs,replayTimeoutMs);
 for(const replayTimeoutMs of [599999,3600001,NaN,Infinity,'1800000',1800000.5])assert.throws(()=>validateConfig({...defaults,replayTimeoutMs}),/replayTimeoutMs/);
 assert.equal(validateConfig({...defaults,timeoutMs:1000,replayTimeoutMs:3600000}).replayTimeoutMs,3600000);
});
