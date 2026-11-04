import {createHash} from 'node:crypto';

// Operational limits and key *names* do not change an already validated summary rule.
// Route/model identity, active content stages and actual output budgets do.
const fields=['aProvider','aModel','claudeEnabled','reviewEnabled','factCheckEnabled',
 'reviewModel','reviewBase','reasoningEffort','maxSummaryChars','outputTokens'];
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function scopeSnapshot(c){
 const keys=[...fields];
 if(c.claudeEnabled!==false)keys.push('claudeModel','claudeBase','claudeOutputTokens');
 if(c.reviewEnabled!==false)keys.push('reviewOutputTokens');
 if(c.factCheckEnabled!==false)keys.push('verificationProvider','verificationModel','verificationOutputTokens','verificationMaxFacts');
 return {schema:2,values:Object.fromEntries(keys.sort().filter(k=>c[k]!==undefined).map(k=>[k,c[k]]))};
}
export const scopeOf=c=>digest(scopeSnapshot(c));
export function scopeStatus(state,c){
 const p=state.active,snapshot=scopeSnapshot(c);
 if(!p||!p.version)return {status:'base',reason:'尚无已验证的自拟策略。',changedFields:[]};
 if(p.scope===digest(snapshot))return {status:'matched',reason:'当前模型与摘要预算符合策略验证范围。',changedFields:[]};
 const previous=p.scopeDetails?.schema===2?p.scopeDetails.values:null;
 const changedFields=previous?[...new Set([...Object.keys(previous),...Object.keys(snapshot.values)])].filter(k=>previous[k]!==snapshot.values[k]):[];
 return {status:'mismatch',storedVersion:p.version,changedFields,
  reason:previous?'模型、内容阶段或摘要预算已变化，暂用基础策略；旧条款仍保留，需重新验证。':'旧版本未保存可比较的作用范围，暂用基础策略；旧条款仍保留，需重新验证。'};
}
export function migrateLegacyScope(state,c){
 // Only upgrade an exact old config hash. Never infer a match for unknown older settings.
 const legacy=digest(Object.entries(c).filter(([k])=>!['replayFeedbackEnabled','replayHarvestEnabled','replayTimeoutMs'].includes(k)).sort(([a],[b])=>a.localeCompare(b)));
 let changed=false;
 const update=p=>{
  if(!p||p.scope!==legacy||p.scopeDetails?.schema===2)return p;
  changed=true;return {...p,scope:scopeOf(c),scopeDetails:scopeSnapshot(c)};
 };
 const active=update(state.active),previous=update(state.previous);
 return changed?{...state,active,previous}:state;
}
