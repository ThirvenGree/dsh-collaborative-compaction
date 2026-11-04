window.__ModuleLoader__.load({id:'dsh-collaborative-compaction',factory:require=>{
const R=require('react'),h=R.createElement;
const API='/dsh-collaborative-compaction/state';

// Colours derive from the host's text colour, so the panel follows DSH light and dark themes.
const CSS=`
.dcc{--dcc-accent:#3b6aa8;--dcc-ok:#2e8b57;--dcc-warn:#b8791d;--dcc-bad:#c2453d;--dcc-ink:#1d2b3f;
 --dcc-line:color-mix(in srgb,currentColor 14%,transparent);--dcc-line-strong:color-mix(in srgb,currentColor 26%,transparent);
 --dcc-soft:color-mix(in srgb,currentColor 4%,transparent);--dcc-muted:color-mix(in srgb,currentColor 64%,transparent);
 --dcc-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
 container-type:inline-size;max-width:980px;padding:28px 24px 96px;line-height:1.6;font-variant-numeric:tabular-nums}
@supports not (color:color-mix(in srgb,red 50%,blue)){.dcc{--dcc-line:rgba(128,128,128,.22);--dcc-line-strong:rgba(128,128,128,.4);--dcc-soft:rgba(128,128,128,.06);--dcc-muted:inherit}}
.dcc *{box-sizing:border-box}
:where(.dcc button){font:inherit;color:inherit}
.dcc :is(button,summary,a):focus-visible{outline:2px solid var(--dcc-accent);outline-offset:2px}
.dcc-head{display:flex;gap:18px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}
.dcc-title{font-size:1.375rem;line-height:1.3;font-weight:650;margin:0}
.dcc-lede{margin:6px 0 0;color:var(--dcc-muted);max-width:40em}
.dcc-headside{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.dcc-master{display:flex;align-items:center;gap:10px;font-weight:550}
.dcc-pill{display:inline-flex;align-items:center;gap:7px;font-size:.8125rem;padding:3px 11px 3px 9px;border-radius:999px;max-width:28em}
.dcc-pill span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dcc-dot{flex:none;width:7px;height:7px;border-radius:50%;background:currentColor}
.dcc-tone-ok{color:color-mix(in srgb,var(--dcc-ok) 78%,currentColor);background:color-mix(in srgb,var(--dcc-ok) 13%,transparent)}
.dcc-tone-warn{color:color-mix(in srgb,var(--dcc-warn) 80%,currentColor);background:color-mix(in srgb,var(--dcc-warn) 14%,transparent)}
.dcc-tone-bad{color:color-mix(in srgb,var(--dcc-bad) 80%,currentColor);background:color-mix(in srgb,var(--dcc-bad) 13%,transparent)}
.dcc-tone-accent{color:color-mix(in srgb,var(--dcc-accent) 80%,currentColor);background:color-mix(in srgb,var(--dcc-accent) 13%,transparent)}
.dcc-tone-neutral{color:var(--dcc-muted);background:var(--dcc-soft)}

.dcc-switch{flex:none;position:relative;width:36px;height:20px;border-radius:999px;border:0;padding:0;cursor:pointer;background:var(--dcc-line-strong);transition:background .15s}
.dcc-switch.is-lg{width:44px;height:24px}
.dcc-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}
.dcc-switch.is-lg .dcc-knob{width:20px;height:20px}
.dcc-switch[aria-checked=true]{background:var(--dcc-accent)}
.dcc-switch[aria-checked=true] .dcc-knob{transform:translateX(16px)}
.dcc-switch.is-lg[aria-checked=true] .dcc-knob{transform:translateX(20px)}

.dcc-flow{margin-top:24px;border:1px solid var(--dcc-line);border-radius:16px;padding:20px 20px 16px;background:var(--dcc-soft)}
.dcc-flow.is-disabled .dcc-track{opacity:.45}
.dcc-flow-off{margin:0 0 14px;font-size:.875rem;color:var(--dcc-muted)}
.dcc-track{display:grid;grid-template-columns:minmax(0,1fr) 26px minmax(0,1.1fr) 26px minmax(0,1fr) 26px minmax(0,1fr) 26px minmax(0,.85fr);align-items:center}
.dcc-pair{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;min-width:0}
.dcc-link{height:1px;background:var(--dcc-line-strong);position:relative;margin:0 3px}
.dcc-link::after{content:"";position:absolute;right:-1px;top:-3px;width:6px;height:6px;border-top:1px solid var(--dcc-line-strong);border-right:1px solid var(--dcc-line-strong);transform:rotate(45deg)}
.dcc-node{min-width:0;border:1px solid var(--dcc-line-strong);border-radius:11px;padding:10px 12px 11px;min-height:96px;display:flex;flex-direction:column;gap:3px}
.dcc-pair .dcc-node{min-height:0}
.dcc-node.is-on{border-color:color-mix(in srgb,var(--dcc-accent) 65%,transparent);background:color-mix(in srgb,var(--dcc-accent) 8%,transparent)}
.dcc-node.is-skip{border-style:dashed}
.dcc-node.is-skip .dcc-node-name,.dcc-node.is-skip .dcc-node-model{opacity:.6}
.dcc-node.is-final{border-color:var(--dcc-line-strong);background:transparent}
.dcc-node-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dcc-node-name{font-weight:600;font-size:.9375rem}
.dcc-node-state{font-size:.75rem;color:var(--dcc-muted);white-space:nowrap}
.dcc-node-model{font-family:var(--dcc-mono);font-size:.75rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dcc-node-note{font-size:.8125rem;color:var(--dcc-muted);line-height:1.45}
.dcc-flow-foot{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:baseline;justify-content:space-between;margin-top:14px;font-size:.875rem}
.dcc-flow-foot p{margin:0;color:var(--dcc-muted);max-width:46em}
.dcc-more{font-size:.875rem}
.dcc-more>summary{cursor:pointer;color:color-mix(in srgb,var(--dcc-accent) 80%,currentColor);list-style:none}
.dcc-more>summary::-webkit-details-marker{display:none}
.dcc-more ul{margin:10px 0 0;padding-left:1.2em;color:var(--dcc-muted);max-width:46em}
.dcc-more li{margin:3px 0}

.dcc-tabs{display:flex;gap:6px;margin-top:30px;border-bottom:1px solid var(--dcc-line)}
.dcc-tab{appearance:none;background:none;border:0;border-bottom:2px solid transparent;margin-bottom:-1px;padding:8px 12px;cursor:pointer;color:var(--dcc-muted)}
.dcc-tab[aria-selected=true]{color:inherit;border-bottom-color:var(--dcc-accent);font-weight:600}
.dcc-count{margin-left:6px;font-size:.75rem;padding:0 6px;border-radius:999px;background:var(--dcc-soft)}

.dcc-group{padding:24px 0;border-bottom:1px solid var(--dcc-line)}
.dcc-group:last-child{border-bottom:0}
.dcc-group h3,.dcc-group>summary{font-size:1rem;font-weight:620;margin:0}
.dcc-group>summary{cursor:pointer;list-style:none;display:flex;align-items:baseline;gap:10px}
.dcc-group>summary::-webkit-details-marker{display:none}
.dcc-group>summary::before{content:"";width:7px;height:7px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transition:transform .15s;align-self:center;opacity:.7}
.dcc-group[open]>summary::before{transform:rotate(45deg)}
.dcc-sub{margin:4px 0 16px;color:var(--dcc-muted);font-size:.875rem}
.dcc-group>summary+.dcc-sub{margin-top:6px}
.dcc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px 22px}
.dcc-field label{display:block;font-size:.875rem;font-weight:550;margin-bottom:6px}
.dcc-input{display:flex;align-items:center;border:1px solid var(--dcc-line-strong);border-radius:8px;transition:border-color .15s,box-shadow .15s}
.dcc-input:focus-within{border-color:var(--dcc-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--dcc-accent) 20%,transparent)}
.dcc-input input,.dcc-input select{flex:1;min-width:0;border:0;background:transparent;color:inherit;font:inherit;padding:8px 10px;outline:none;appearance:none}
.dcc-input select{cursor:pointer;padding-right:28px}
.dcc-input.is-select{position:relative}
.dcc-input.is-select::after{content:"";position:absolute;right:12px;top:50%;width:6px;height:6px;margin-top:-5px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(45deg);opacity:.6;pointer-events:none}
.dcc-input option{color:#1b1f24;background:#fff}
.dcc-input.is-mono input{font-family:var(--dcc-mono);font-size:.875rem}
.dcc-unit{padding:0 11px 0 4px;color:var(--dcc-muted);font-size:.8125rem;white-space:nowrap}
.dcc-hint{font-size:.8125rem;color:var(--dcc-muted);margin-top:5px;min-height:1.2em}
.dcc-field.is-invalid .dcc-input{border-color:var(--dcc-bad)}
.dcc-field.is-invalid .dcc-hint{color:color-mix(in srgb,var(--dcc-bad) 85%,currentColor)}
.dcc-field.is-changed label::after{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--dcc-accent);margin-left:7px;vertical-align:middle}

.dcc-bar{position:sticky;bottom:16px;z-index:2;margin-top:18px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 12px 10px 18px;border-radius:12px;background:var(--dcc-ink);color:#f3f6fa;box-shadow:0 8px 24px rgba(10,20,35,.28)}
.dcc-bar-text{flex:1;min-width:12em;font-size:.875rem}
.dcc-bar-text strong{font-weight:600}
.dcc-btn{appearance:none;border-radius:8px;padding:7px 14px;cursor:pointer;border:1px solid transparent;font-weight:550}
.dcc-btn:disabled{cursor:not-allowed;opacity:.55}
.dcc-btn-primary{background:var(--dcc-accent);color:#fff!important}
.dcc-bar .dcc-btn-primary{background:#fff;color:var(--dcc-ink)!important}
.dcc-btn-ghost{background:transparent;border-color:currentColor}
.dcc-bar .dcc-btn-ghost{border-color:rgba(255,255,255,.4)}
.dcc-btn-text{background:none;border:0;padding:4px 6px;color:color-mix(in srgb,var(--dcc-accent) 80%,currentColor)!important;cursor:pointer}
.dcc-flash{margin-top:18px;padding:10px 14px;border-radius:10px;font-size:.875rem}

.dcc-runs-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:20px 0 4px}
.dcc-filters{display:flex;gap:6px;flex-wrap:wrap}
.dcc-chip{border:1px solid var(--dcc-line-strong);border-radius:999px;padding:3px 12px;background:none;cursor:pointer;font-size:.8125rem}
.dcc-chip[aria-pressed=true]{border-color:var(--dcc-accent);background:color-mix(in srgb,var(--dcc-accent) 13%,transparent);font-weight:600}
.dcc-chip .dcc-n{margin-left:5px;opacity:.7}
.dcc-runs-note{font-size:.8125rem;color:var(--dcc-muted);margin:6px 0 10px;max-width:52em}
.dcc-empty{padding:36px 0;color:var(--dcc-muted);font-size:.9375rem}
.dcc-run{border-top:1px solid var(--dcc-line)}
.dcc-run:last-child{border-bottom:1px solid var(--dcc-line)}
.dcc-run>summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:8.6em 2.6em 5.6em 4.8em minmax(0,1fr);gap:12px;align-items:center;padding:11px 6px;font-size:.875rem}
.dcc-run>summary::-webkit-details-marker{display:none}
.dcc-run>summary:hover{background:var(--dcc-soft)}
.dcc-run[open]>summary{background:var(--dcc-soft)}
.dcc-time{color:var(--dcc-muted);white-space:nowrap}
.dcc-kind{white-space:nowrap}
.dcc-badge{display:inline-block;font-size:.75rem;line-height:1.5;padding:1px 8px;border-radius:6px;white-space:nowrap}
.dcc-dur{white-space:nowrap;text-align:right;color:var(--dcc-muted)}
.dcc-detail{min-width:0;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.dcc-reason{color:var(--dcc-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.dcc-stage{display:inline-flex;align-items:center;gap:5px;font-size:.75rem;border:1px solid var(--dcc-line);border-radius:6px;padding:1px 7px;white-space:nowrap;background:transparent}
.dcc-stage .dcc-dot{width:6px;height:6px}
.dcc-stage-ms{color:var(--dcc-muted)}
.dcc-run-body{padding:6px 6px 20px;font-size:.875rem}
.dcc-meta{display:flex;flex-wrap:wrap;gap:4px 22px;color:var(--dcc-muted);margin:6px 0 12px}
.dcc-meta b{font-weight:550;color:inherit}
.dcc-error{margin:4px 0 14px;padding:9px 12px;border-radius:8px;font-size:.8125rem;word-break:break-word}
.dcc-table-wrap{overflow-x:auto}
.dcc-table{width:100%;border-collapse:collapse;font-size:.8125rem}
.dcc-table th,.dcc-table td{text-align:left;padding:7px 10px 7px 0;border-bottom:1px solid var(--dcc-line);vertical-align:top}
.dcc-table th{font-weight:550;color:var(--dcc-muted)}
.dcc-table td.dcc-mono{font-family:var(--dcc-mono);font-size:.75rem}
.dcc-ranges{margin:4px 0 12px;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:6px}
.dcc-ranges li{font-family:var(--dcc-mono);font-size:.75rem;border:1px solid var(--dcc-line);border-radius:6px;padding:1px 7px}
.dcc-raw{margin-top:12px}
.dcc-raw>summary{cursor:pointer;color:var(--dcc-muted);font-size:.8125rem}
.dcc-raw pre{font-family:var(--dcc-mono);font-size:.75rem;line-height:1.5;max-height:320px;overflow:auto;background:var(--dcc-soft);padding:12px;border-radius:8px;margin:8px 0 0;white-space:pre-wrap;word-break:break-all}
.dcc-loading{color:var(--dcc-muted);padding:20px 0}

@container (max-width:760px){
 .dcc-track{grid-template-columns:minmax(0,1fr)}
 .dcc-link{height:18px;width:1px;margin:3px auto}
 .dcc-link::after{right:-3px;top:auto;bottom:0;transform:rotate(135deg)}
 .dcc-pair{grid-template-columns:repeat(2,minmax(0,1fr))}
 .dcc-node{min-height:0}
 .dcc-grid{grid-template-columns:minmax(0,1fr)}
 .dcc-run>summary{grid-template-columns:auto auto minmax(0,1fr) auto;row-gap:6px}
 .dcc-run>summary .dcc-detail{grid-column:1/-1}
}
@media (prefers-reduced-motion:reduce){.dcc *{transition:none!important}}
`;

const NUM={timeoutMs:[1000,580000,'ms'],replayTimeoutMs:[600000,3600000,'ms'],replaySliceCalls:[1,100,'次'],replayDailyCalls:[1,10000,'次'],replayDailyTokens:[1000,100000000,'token'],replaySliceMs:[1000,600000,'ms'],replayResumeMinutes:[1,1440,'分钟'],plannerTimeoutMs:[1000,120000,'ms'],retries:[0,3,'次'],maxSummaryChars:[100,100000,'字'],verificationMaxFacts:[1,100,'条'],preserveRecentTokens:[1000,100000,'token'],autoFoldTargetTokens:[8192,10000000,'token'],outputTokens:[256,128000,'token'],plannerOutputTokens:[256,128000,'token'],claudeOutputTokens:[256,128000,'token'],reviewOutputTokens:[256,128000,'token'],verificationOutputTokens:[256,128000,'token'],claudeContextTokens:[4096,2000000,'token'],reviewContextTokens:[4096,2000000,'token']};
const SELECT={verificationProvider:[['claude','Claude'],['openai','OpenAI 兼容接口']],reasoningEffort:[['none','不推理'],['low','低'],['medium','中'],['high','高'],['xhigh','很高'],['max','最高']]};
const MODEL=['aProvider','aModel','claudeModel','reviewModel','plannerModel','verificationModel'];
const ENV=['claudeKeyEnv','reviewKeyEnv'],URLS=['claudeBase','reviewBase'];
const MONO=new Set([...MODEL,...ENV,...URLS]);

const GROUPS=[
 {id:'models',title:'模型',sub:'每个阶段调用的模型。密钥只从本机环境变量读取，不会写进设置。',fields:[
  ['aProvider','A 摘要的 Provider','DSH 里配置的 Provider 名称'],['aModel','A 摘要模型'],
  ['claudeModel','B 摘要的 Claude 模型'],['reviewModel','交叉审核模型'],
  ['plannerModel','规划模型','规划固定使用低推理强度'],['reasoningEffort','推理强度','用于交叉审核和 OpenAI 核验'],
  ['verificationProvider','核验服务'],['verificationModel','核验模型']]},
 {id:'budget',title:'时间与篇幅',sub:'超时或超出篇幅时整批放弃，会话原文保持不变。',fields:[
  ['timeoutMs','单次压缩流水线超时'],['plannerTimeoutMs','规划超时'],
  ['replayTimeoutMs','校准单次运行超时','默认 30 分钟，可设 10–60 分钟；已完成步骤会保留，恢复后接着验证'],
  ['maxSummaryChars','每段摘要字数上限'],['verificationMaxFacts','核验引用的关键事实'],
  ['preserveRecentTokens','不压缩的最近历史'],['autoFoldTargetTokens','自动折叠目标','范围 8192–10000000；启用模型规划时也须有效'],
  ['retries','网络失败重试']]},
 {id:'calibration',title:'后台校准预算',sub:'初始化和完整验证分批进行。达到预算会暂停并保存进度；每日额度按 UTC 日期重置。保存的预算从下一批生效，不清空已验证的策略。',fields:[
  ['replaySliceCalls','每批模型请求上限','默认 12 次；A、Claude、审核、核验及网络重试分别计数'],
  ['replaySliceMs','每批启动请求的时间窗口','默认 2 分钟；时间到后不再发起新请求，已发起的请求仍受各自超时保护'],
  ['replayResumeMinutes','分批恢复间隔','默认 15 分钟；每日预算不足时等待次日额度'],
  ['replayDailyCalls','每日模型请求上限','默认 120 次，只统计策略校准，不包含正常压缩和题库提炼'],
  ['replayDailyTokens','每日 token 预算','默认 100 万；调用前保守预留，返回 usage 时结算；缺少 usage 或意外中断时按预留记账，不等于费用账单']]},
 {id:'output',title:'输出上限',sub:'各阶段单次回复最多生成的 token，推理 token 也算在内。',fields:[
  ['outputTokens','A 摘要'],['claudeOutputTokens','B 摘要'],['reviewOutputTokens','交叉审核'],
  ['verificationOutputTokens','事实核验'],['plannerOutputTokens','规划']]},
 {id:'advanced',title:'接口与上下文预算',sub:'一般不需要修改。',collapsed:true,fields:[
  ['claudeBase','Claude API 地址'],['reviewBase','OpenAI 兼容 API 地址','交叉审核、规划和 OpenAI 核验都走这里'],
  ['claudeKeyEnv','Claude 密钥的环境变量名'],['reviewKeyEnv','OpenAI 密钥的环境变量名'],
  ['claudeContextTokens','Claude 上下文预算'],['reviewContextTokens','OpenAI 上下文预算']]}
];

const fmt=n=>Number(n).toLocaleString('zh-CN');
function human(key,value){
 const n=Number(value);if(!NUM[key]||!/^\d+$/.test(String(value).trim()))return '';
 const unit=NUM[key][2];
 if(unit==='ms'){const s=n/1000;return s<60?`约 ${+s.toFixed(1)} 秒`:`约 ${+(s/60).toFixed(1)} 分钟`;}
 if(unit==='token'&&n>=1000)return n>=1e6?`约 ${+(n/1e6).toFixed(2)}M token`:`约 ${+(n/1000).toFixed(1)}k token`;
 return '';
}
function check(key,value){
 const text=String(value??'');
 if(NUM[key]){const [lo,hi]=NUM[key];if(!/^\d+$/.test(text.trim()))return '请输入整数';const n=Number(text);return n<lo||n>hi?`请输入 ${fmt(lo)} 到 ${fmt(hi)} 之间的数`:'';}
 if(MODEL.includes(key))return !text.trim()?'不能为空':text.length>100?'最多 100 个字符':'';
 if(ENV.includes(key))return /^[A-Z][A-Z0-9_]{1,80}$/.test(text)?'':'用大写字母开头，只含大写字母、数字和下划线';
 if(URLS.includes(key)){try{const u=new URL(text);return u.protocol!=='https:'||u.username||u.password||u.search||u.hash?'需要 https 地址，不能带账号、查询参数或锚点':'';}catch{return '不是有效的网址';}}
 return '';
}
function toDraft(config){const d={};for(const [k,v] of Object.entries(config||{}))d[k]=typeof v==='number'?String(v):v;return d;}
function fromDraft(draft){const c={};for(const [k,v] of Object.entries(draft))c[k]=NUM[k]?Number(String(v).trim()):typeof v==='string'?v.trim():v;return c;}
function changedKeys(a,b){if(!a||!b)return [];return Object.keys(a).filter(k=>String(a[k])!==String(b[k]));}

function healthOf(state,loadError){
 if(loadError&&!state)return ['bad','无法读取设置'];
 const v=state?.health;
 if(v==='ready')return ['ok','本地服务已就绪'];
 if(!v||v==='starting')return ['warn','本地服务启动中'];
 if(v.startsWith('listener failed'))return ['bad','本地服务未能启动：'+v.slice(17).replace(/^:\s*/,'')];
 if(v.startsWith('engine config failed'))return ['bad','引擎配置写入失败：'+v.slice(21).replace(/^:\s*/,'')];
 return ['bad',v];
}
function clock(ts){try{return new Date(ts).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});}catch{return '';}}
function duration(ms){
 if(typeof ms!=='number'||!isFinite(ms)||ms<0)return '—';
 if(ms<1000)return `${Math.round(ms)} 毫秒`;
 if(ms<60000)return `${(ms/1000).toFixed(ms<10000?1:0)} 秒`;
 const m=Math.floor(ms/60000),s=Math.round((ms%60000)/1000);return `${m} 分 ${String(s).padStart(2,'0')} 秒`;
}
function tokens(usage){
 if(!usage)return null;let i=0,o=0,any=false;
 for(const x of Array.isArray(usage)?usage:[usage]){
  if(!x||typeof x!=='object')continue;
  const a=x.input_tokens??x.inputTokens??x.prompt_tokens,b=x.output_tokens??x.outputTokens??x.completion_tokens;
  if(typeof a==='number'){i+=a;any=true;}if(typeof b==='number'){o+=b;any=true;}
 }
 return any?`${fmt(i)} / ${fmt(o)}`:null;
}
const STAGE_NAME={A:'A 摘要',B:'B 摘要',review:'审核','fact-check':'核验'};
const stageTone=s=>s==='success'?'ok':s==='failed'?'bad':'warn';
const stageLabel=s=>s==='success'?'通过':s==='failed'?'失败':s==='paused'?'等待续跑':'进行中';
function runStatus(r){
 if(r.status==='running')return ['warn','进行中'];
 if(r.status==='paused')return ['warn','预算暂停'];
 if(r.status==='failed')return ['bad','失败'];
 if(r.kind==='planning'){const d={now:'立即压缩',wait:'暂缓',uncertain:'不确定',legacy:'按原阈值'}[r.decision]||'已决定';return [r.decision==='now'?'accent':'neutral',d];}
 if(r.status==='validated')return ['ok','已校验'];
 return ['neutral',r.status||'未知'];
}
const elapsedOf=r=>typeof r.elapsedMs==='number'?r.elapsedMs:r.status==='running'?Date.now()-r.startedAt:undefined;

function Switch({checked,onChange,label,large}){
 return h('button',{type:'button',role:'switch','aria-checked':checked?'true':'false','aria-label':label,className:'dcc-switch'+(large?' is-lg':''),onClick:()=>onChange(!checked)},h('span',{className:'dcc-knob'}));
}

function Flow({d,set,saved}){
 const aRuns=!d.claudeEnabled||d.reviewEnabled;
 const node=o=>h('div',{className:'dcc-node '+(o.final?'is-final':o.on?'is-on':'is-skip')},
  h('div',{className:'dcc-node-top'},h('span',{className:'dcc-node-name'},o.name),
   o.toggle?h(Switch,{checked:!!d[o.toggle],label:o.name,onChange:v=>set(o.toggle,v)}):h('span',{className:'dcc-node-state'},o.state)),
  o.model?h('div',{className:'dcc-node-model',title:o.model},o.model):null,
  h('div',{className:'dcc-node-note'},o.on?o.noteOn:o.noteOff));
 const link=()=>h('div',{className:'dcc-link','aria-hidden':'true'});
 return h('div',{className:'dcc-flow'+(d.enabled?'':' is-disabled')},
  d.enabled?null:h('p',{className:'dcc-flow-off'},saved?'协作压缩已关闭，压缩由引擎原来的配置处理。打开右上角的开关并保存即可启用。':'保存后协作压缩关闭，引擎恢复原来的压缩配置。'),
  h('div',{className:'dcc-track',role:'group','aria-label':'压缩流程'},
   node({name:'规划',toggle:'plannerEnabled',on:d.plannerEnabled,model:d.plannerModel,noteOn:'模型决定何时压缩、压哪一段',noteOff:'按引擎原有的阈值触发'}),
   link(),
   h('div',{className:'dcc-pair'},
    node({name:'A 摘要',state:aRuns?'运行':'跳过',on:aRuns,model:`${d.aProvider||''}/${d.aModel||''}`,noteOn:'DSH 原有的摘要模型',noteOff:'Claude 开启且不审核时跳过'}),
    node({name:'B 摘要',toggle:'claudeEnabled',on:d.claudeEnabled,model:d.claudeModel,noteOn:'Claude 原生压缩',noteOff:'不调用 Claude'})),
   link(),
   node({name:'交叉审核',toggle:'reviewEnabled',on:d.reviewEnabled,model:d.reviewModel,noteOn:'对照原文合并 A 与 B',noteOff:'直接采用单一摘要'}),
   link(),
   node({name:'事实核验',toggle:'factCheckEnabled',on:d.factCheckEnabled,model:d.verificationModel,noteOn:'引用原文核对关键事实',noteOff:'不做事实核验'}),
   link(),
   node({name:'写回会话',state:'必经',final:true,on:true,noteOn:'全部阶段通过才提交，失败时原文不变'})),
  h('div',{className:'dcc-flow-foot'},
   h('p',null,'上下文用到有效预算的 90% 时，即使规划选择暂缓也会强制尝试压缩；任何一步失败都不提交。'),
   h('details',{className:'dcc-more'},h('summary',null,'工作方式'),
    h('ul',null,
     h('li',null,'候选历史没有明显增长（不超过 8k token 或窗口的 10%，取较小值）时，沿用上一次的暂缓判断，最长 30 分钟。'),
     h('li',null,'自动压缩失败后暂停 10 分钟；达到 90% 硬阈值时不受暂停限制。'),
     h('li',null,'软阈值下后台审核，期间可继续追加消息。下一次请求会在工具配对完整时核对旧范围并提交；若原范围变了则丢弃。'),
     h('li',null,'可用 search_context 查找自己会话的原文、旧摘要及附件说明，按命中的 open: 引用继续阅读。'),
     h('li',null,'关闭总开关会恢复引擎原来的压缩配置；对话模型、人设和记忆不受影响。')))));
}

function Field({k,label,hint,value,base,onChange}){
 const err=check(k,value),changed=base&&String(base[k])!==String(value),id='dcc-f-'+k;
 const help=err||hint||human(k,value);
 const control=SELECT[k]
  ?h('div',{className:'dcc-input is-select'},h('select',{id,value,onChange:e=>onChange(k,e.target.value)},SELECT[k].map(([v,t])=>h('option',{key:v,value:v},t))))
  :h('div',{className:'dcc-input'+(MONO.has(k)?' is-mono':'')},
    h('input',{id,type:'text',value:value??'',inputMode:NUM[k]?'numeric':undefined,spellCheck:false,autoComplete:'off','aria-invalid':err?'true':'false','aria-describedby':id+'-hint',onChange:e=>onChange(k,e.target.value)}),
    NUM[k]?h('span',{className:'dcc-unit'},NUM[k][2]==='ms'?'毫秒':NUM[k][2]):null);
 return h('div',{className:'dcc-field'+(err?' is-invalid':'')+(changed?' is-changed':'')},
  h('label',{htmlFor:id},label),control,
  h('div',{className:'dcc-hint',id:id+'-hint'},help&&hint&&!err&&human(k,value)?`${hint}，${human(k,value)}`:help));
}

function Settings({draft,base,set}){
 return h('div',null,GROUPS.map(g=>{
  const grid=h('div',{className:'dcc-grid'},g.fields.map(([k,label,hint])=>h(Field,{key:k,k,label,hint,value:draft[k],base,onChange:set})));
  if(g.collapsed){
   const open=g.fields.some(([k])=>check(k,draft[k])||(base&&String(base[k])!==String(draft[k])));
   return h('details',{key:g.id,className:'dcc-group',open:open||undefined},h('summary',null,g.title),h('p',{className:'dcc-sub'},g.sub),grid);
  }
  return h('section',{key:g.id,className:'dcc-group','aria-labelledby':'dcc-g-'+g.id},h('h3',{id:'dcc-g-'+g.id},g.title),h('p',{className:'dcc-sub'},g.sub),grid);
 }));
}

function RunBody({r}){
 const raw=h('details',{className:'dcc-raw'},h('summary',null,'原始记录'),h('pre',null,JSON.stringify(r,null,2)));
 const error=r.error?h('div',{className:'dcc-error dcc-tone-'+(r.status==='paused'?'warn':'bad')},r.error):null;
 if(r.kind==='planning'){
  const t=tokens(r.usage);
  return h('div',{className:'dcc-run-body'},error,
   h('div',{className:'dcc-meta'},h('span',null,'模型 ',h('b',null,r.model||'—')),t?h('span',null,'token 输入/输出 ',h('b',null,t)):null),
   r.reason?h('p',{style:{margin:'0 0 10px'}},r.reason):null,
   r.ranges?.length?h(R.Fragment,null,h('div',{className:'dcc-meta',style:{margin:'0 0 4px'}},`选中 ${r.ranges.length} 段历史`),h('ul',{className:'dcc-ranges'},r.ranges.map((x,i)=>h('li',{key:i},x.startId===x.endId?x.startId:`${x.startId} – ${x.endId}`)))):null,
   raw);
 }
 const mode=r.mode?[r.mode.claude?'Claude 开':'Claude 关',r.mode.review?'审核开':'审核关']:[];
 return h('div',{className:'dcc-run-body'},error,
  h('div',{className:'dcc-meta'},
   typeof r.sourceChars==='number'?h('span',null,'原文 ',h('b',null,fmt(r.sourceChars)),' 字'):null,
   mode.length?h('span',null,mode.join('，')):null,
   r.trigger?h('span',null,'入口：',({manual:'手动命令',tool:'会话工具',auto:'自动压缩',direct:'直接调用'})[r.trigger]||r.trigger):null,
   r.policyVersion!==undefined?h('span',null,'摘要策略 v'+r.policyVersion+((r.policyRules||[]).length?' · '+r.policyRules.join(' / '):'')):null,
   r.configFingerprint?h('span',{title:r.configFingerprint},'配置指纹 ',r.configFingerprint.slice(0,12)):null,
   r.retryAfter?h('span',null,'自动重试最早时间 ',new Date(r.retryAfter).toLocaleString()):null,
   r.status==='validated'?h('span',null,'已通过校验，是否写回以引擎记录为准'):null),
  r.stages?.length?h('div',{className:'dcc-table-wrap'},h('table',{className:'dcc-table'},
   h('thead',null,h('tr',null,['阶段','模型','结果','用时','token 输入/输出','备注'].map(x=>h('th',{key:x,scope:'col'},x)))),
   h('tbody',null,r.stages.map((s,i)=>{
    const notes=[s.outputChars!=null?`输出 ${fmt(s.outputChars)} 字`:null,s.evidenceCount!=null?`引证 ${s.evidenceCount} 条`:null,s.softLiteralWarnings?`字面量软警告 ${s.softLiteralWarnings}`:null,s.error||null].filter(Boolean);
    return h('tr',{key:i},
     h('td',null,STAGE_NAME[s.name]||s.name),h('td',{className:'dcc-mono'},s.model||'—'),
     h('td',null,h('span',{className:'dcc-badge dcc-tone-'+stageTone(s.status)},stageLabel(s.status))),
     h('td',null,duration(s.elapsedMs)),h('td',null,tokens(s.usage)||'—'),h('td',null,notes.join('；')||'—'));
   })))):null,
  raw);
}

function Runs({runs,notice,onRefresh}){
 const [filter,setFilter]=R.useState('all');
 const sets={all:runs,summary:runs.filter(r=>r.kind!=='planning'),planning:runs.filter(r=>r.kind==='planning'),failed:runs.filter(r=>r.status==='failed'),paused:runs.filter(r=>r.status==='paused')};
 const list=sets[filter];
 const labels=[['all','全部'],['summary','摘要'],['planning','规划'],['failed','失败'],['paused','预算暂停']];
 return h('div',null,
  h('div',{className:'dcc-runs-head'},
   h('div',{className:'dcc-filters',role:'group','aria-label':'筛选运行记录'},labels.map(([k,t])=>h('button',{key:k,type:'button',className:'dcc-chip','aria-pressed':filter===k?'true':'false',onClick:()=>setFilter(k)},t,h('span',{className:'dcc-n'},sets[k].length)))),
   h('button',{type:'button',className:'dcc-btn-text',onClick:onRefresh},'立即刷新')),
  h('p',{className:'dcc-runs-note'},'每 5 秒自动刷新，保留最近 100 条。',notice?' '+notice:''),
  list.length===0?h('div',{className:'dcc-empty'},runs.length?'没有符合筛选条件的记录。':'还没有运行记录。启用协作压缩后，每次规划和摘要都会记在这里。'):
  h('div',null,list.map(r=>{
   const [tone,label]=runStatus(r);
   const detail=r.kind==='planning'
    ?h('span',{className:'dcc-reason',title:r.reason||r.error||''},r.error||r.reason||'')
    :(r.stages||[]).map((s,i)=>h('span',{key:i,className:'dcc-stage'},h('span',{className:'dcc-dot dcc-tone-'+stageTone(s.status),style:{background:'currentColor'}}),STAGE_NAME[s.name]||s.name,s.elapsedMs!=null?h('span',{className:'dcc-stage-ms'},duration(s.elapsedMs)):null));
   return h('details',{key:r.id,className:'dcc-run'},
    h('summary',null,
     h('span',{className:'dcc-time'},clock(r.startedAt)),
     h('span',{className:'dcc-kind'},r.kind==='planning'?'规划':'摘要'),
     h('span',null,h('span',{className:'dcc-badge dcc-tone-'+tone},label)),
     h('span',{className:'dcc-dur'},duration(elapsedOf(r))),
     h('span',{className:'dcc-detail'},detail)),
    h(RunBody,{r}));
  })));
}

const replayLabels={'omitted-tool':'原工具名','later-correction':'后续更正','unconfirmed-click':'操作未确认','adequate-summary-control':'摘要充足对照','execution-error':'调用出错','baseline-inconclusive':'原文对照未通过','summary-sufficient':'摘要足够','retrieval-regression':'回查组退步','citation-recovered':'回查补齐引用','correct-answer-without-grounding':'行为正确但引文不足','recovered-by-recall':'回查恢复','did-not-search':'未发起回查','search-missed-evidence':'未查到关键依据','evidence-returned-answer-failed':'已查到依据但没有正确使用'};
const scopeFieldLabels=Object.fromEntries(GROUPS.flatMap(group=>group.fields.map(([key,label])=>[key,label])).concat([
 ['claudeEnabled','Claude 摘要开关'],['reviewEnabled','交叉审核开关'],['factCheckEnabled','事实核验开关']
]));
function PolicyScope({scope}){
 if(scope?.status!=='mismatch')return null;
 return h('aside',{className:'dcc-flash dcc-tone-warn',role:'alert'},
  h('strong',null,'已保存的策略 v'+scope.storedVersion+' 暂未生效'),
  h('p',null,scope.reason),scope.changedFields?.length?h('p',null,'变化的设置：'+scope.changedFields.map(key=>scopeFieldLabels[key]||key).join('、')):null,
  h('p',null,'旧条款没有删除。可恢复原来的模型与摘要预算，或手动重新校准。'));
}
const calibrationLabels={running:'正在分批校准',paused:'已保存进度，等待继续',failed:'暂未完成，等待恢复',completed:'本轮已完成',invalidated:'依据已变化，准备重新验证'};
const calibrationPhases={bootstrap:'初始化基线',diagnostic:'三路诊断','discovery-old-1':'复现现行策略的问题','hidden-old-1':'验证未见题的现行基线','candidate-1':'对照候选与现行策略','old-repeat-2':'第二次独立生成现行摘要','candidate-repeat-2':'第二次独立生成候选摘要','proposal-review':'生成并独立审核新条款'};
function ReplayProgress({replay,calibration,enabled,config}){
 const schedule=replay?.policy?.automatic||replay?.schedule,progress=replay?.running?replay.progress:null;
 const completed=[replay?.policy?.last?.telemetry,replay?.report?.telemetry].filter(Boolean).sort((a,b)=>(b.startedAt||0)-(a.startedAt||0));
 const last=progress||calibration?.telemetry||completed[0],baseline=replay?.policy?.baseline?.current===false?null:replay?.policy?.baseline;
 const current=calibration||replay?.calibration,usage=current?.usage;
 const active=enabled&&config?.enabled;
 const phasePath=progress?.phase||current?.phase;
 const phase=typeof phasePath==='string'&&Object.entries(calibrationPhases).find(([key])=>phasePath.split('/').includes(key))?.[1];
 return h('div',{className:'dcc-more',role:'status'},
  h('div',{className:'dcc-head'},h('strong',null,current?.kind==='validation'?'候选策略验证':'自动基线初始化'),
   h('span',{className:'dcc-pill dcc-tone-'+(!active?'neutral':current?.status==='completed'?'ok':current?.status==='failed'?'bad':'warn')},!active?'后台校准已关闭':calibrationLabels[current?.status]||'等待后台小批初始化')),
  schedule?h('p',null,schedule.reason+(active&&schedule.nextAt?' 下次考虑：'+clock(schedule.nextAt):'')):null,
  current?h(R.Fragment,null,
   h('p',null,'当前阶段：'+(phase||phasePath||(current.kind==='bootstrap'?'初始化基线':'对照验证'))+(current.reason?' · '+current.reason:'')),
   h('div',{className:'dcc-meta'},h('span',null,'已保存步骤 ',h('b',null,current.completedTasks??0)),
    current.coverage?h('span',null,'已覆盖问题 ',h('b',null,(current.coverage.completed??0)+' / '+(current.coverage.total??'—'))):null,
    current.updatedAt?h('span',null,'更新于 '+clock(current.updatedAt)):null),
   current.nextAt&&active?h('p',{className:'dcc-hint'},'最早恢复：'+clock(current.nextAt)):null):null,
  baseline?h('p',null,'当前范围的基线记录：'+clock(baseline.at)+(baseline.coverage?' · 已覆盖 '+(baseline.coverage.completed??0)+' / '+(baseline.coverage.total??'—')+' 题':'')+'。建立基线只表示完成诊断，不表示新的压缩策略已获准。'):
   h('p',{className:'dcc-hint'},'尚无当前范围的完整基线。后台先用现行压缩流水线生成摘要，再对照原文、摘要和回查结果；小批初始化本身不会改写正式策略。'),
  Array.isArray(baseline?.failures)&&baseline.failures.length?h('p',null,'基线发现的待复核问题：'+baseline.failures.map(item=>typeof item==='string'?(replayLabels[item]||item):(replayLabels[item.id]||item.id||item.reason||'待复核')).join('、')):null,
  !enabled?h('p',{className:'dcc-hint'},'此开关关闭时，手动按钮只做三路诊断，不修改策略，也不启用后台校准。'):null,
  usage?h('div',{className:'dcc-meta'},
   h('span',null,'UTC 日 '+usage.day),
   h('span',null,'模型请求 ',h('b',null,fmt(usage.calls??0)+' / '+fmt(config?.replayDailyCalls??120))),
   h('span',null,'已记账 token ',h('b',null,fmt(usage.tokens??0)+' / '+fmt(config?.replayDailyTokens??1000000))),
   usage.estimatedTokens?h('span',null,'其中保守估算 ',h('b',null,fmt(usage.estimatedTokens))):null,
   usage.reservedTokens?h('span',null,'在途预留 ',h('b',null,fmt(usage.reservedTokens))):null):null,
  last?h('div',{className:'dcc-meta'},
   h('span',null,progress?'本次运行已用时 ':'最近运行耗时 ',h('b',null,duration(progress?Date.now()-last.startedAt:last.elapsedMs))),
   h('span',null,'本次运行时限 ',h('b',null,duration(last.timeoutMs))),
   h('span',null,'DSH 阅读/提案调用 ',h('b',null,last.readerCalls??0)),
   h('span',null,'完整压缩流水线 ',h('b',null,last.pipelineCalls??0)),
   h('span',null,'独立条款审核 ',h('b',null,last.proposalReviews??0))):null,
  h('p',{className:'dcc-hint'},'请求预算统计每次实际模型请求，完整流水线会包含多次请求。token 按服务返回的 usage 结算，缺失时保守估算；不是费用账单。独立样例最多 3 路并发，重启后续用已完成步骤；用于验证重复性的两次摘要仍须独立生成。'));
}
const harvestLabels={cancelled:'已取消',conflict:'题目隔离冲突',admitted:'样例审核通过',added:'已加入动态题库',duplicate:'已有对应样例',full:'题库已满',held:'暂未采用',clean:'未复现压缩遗漏',unavailable:'本次未完成',failed:'本次未完成',skipped:'本次未收集',queued:'等待后台处理',running:'正在检查',cleared:'已清空动态题库',interrupted:'上次处理已中断'};
function HarvestBank({state,draft,set,onAction}){
 const info=state?.replay?.harvest;
 const current=info?info.blockedReason?'已暂停：交叉审核关闭':info.running?'正在提炼和验证':info.enabled?'已开启，等待压缩结果':'已关闭':'尚未读取运行状态';
 const entries=info?.entries||[];
 const modelNames=models=>Array.isArray(models)?models.join(' / '):models&&typeof models==='object'?Object.values(models).filter(x=>typeof x==='string').join(' / '):typeof models==='string'?models:'—';
 return h('section',{className:'dcc-group','aria-labelledby':'dcc-harvest-title'},
  h('div',{className:'dcc-head'},h('h3',{id:'dcc-harvest-title'},'从实际遗漏更新回放题库'),
   h('span',{className:'dcc-pill dcc-tone-'+(info?.running?'warn':info?.enabled?'ok':'neutral')},current)),
  h('label',{className:'dcc-master'},h(Switch,{checked:!!draft.replayHarvestEnabled,label:'从正式压缩中提炼脱敏回放样例',onChange:v=>set('replayHarvestEnabled',v)}),'自动提炼脱敏样例'),
  info?.blockedReason?h('p',{role:'status',className:'dcc-hint'},info.blockedReason):null,
  h('p',{className:'dcc-sub'},'提炼开关保留默认开启，但必须同时启用交叉审核才能运行。关闭交叉审核会取消正在处理的提炼并清空待处理原文；重新开启后只处理新任务。'),
  h('p',{className:'dcc-sub'},'在正式压缩得到候选摘要后，后台核对原文与摘要。确认遗漏后，模型改写为另一种虚构情境，独立审核脱敏程度、含义和答案，再验证原文、摘要与回查三路。回放自身不再产生新题。'),
  h('p',{className:'dcc-hint'},'原文发送范围：最多 120,000 字符的本次正式压缩原文及候选摘要，会交给生成模型 '+(state?.config?.aProvider||'DSH')+' / '+(state?.config?.aModel||'当前模块 A 模型')+'，并交给独立审核模型 '+(info?.reviewModel||state?.config?.reviewModel||'当前审核模型')+'。审核接口：'+(info?.reviewEndpoint||(state?.config?.reviewBase?state.config.reviewBase.replace(/\/$/,'')+'/responses':'尚未读取'))+'。脱敏发生在模型处理之后，不是在发送原文之前。'),
  h('p',{className:'dcc-hint'},'提炼使用独立的每日任务额度，不计入上方策略校准的每日请求 / token 预算。一次完整提炼按流程包含 15–27 次模型请求；提前放弃会更少，底层服务自身重试另计。每日 4 次指任务次数，不是 4 次模型调用。'),
  h('div',{className:'dcc-meta'},
   h('span',null,'已审核入库 ',h('b',null,info?.approvedCount??'—'),' 组'),
   h('span',null,'队列 ',h('b',null,info?.queued??'—')),
   h('span',null,'今日提炼任务 ',h('b',null,info?.today?info.today.attempts+' / '+info.today.limit:'—'))),
  info?.last?h('p',{role:'status'},clock(info.last.at)+' · '+(harvestLabels[info.last.status]||info.last.status)+(info.last.reason?' · '+info.last.reason:'')):null,
  info?.nextRetryAt>Date.now()?h('p',{className:'dcc-hint'},'恢复后最早再试：'+clock(info.nextRetryAt)):null,
  h('p',null,'入库表示可以参加回放，不代表策略已经改变。后台先分批建立现行策略的基线，新样例可进入后续诊断；完成初始化后，新题库按 24 小时窗口参与对照，其余新题合并等待。仍需通过独立正例、边界反例、重复验证和无退步检查。'),
  h('details',{className:'dcc-more'},h('summary',null,'收集范围与保存方式'),
   h('p',null,'只观察启用后的正式压缩，不扫描旧聊天目录。来源原文与原摘要只在本次后台任务内存中使用；本地题库保存审核通过的虚构样例、摘要指纹和模型信息，不保存正式聊天片段。'),
   h('p',null,'原文会交给配置的模型进行临时核对，不给模型工具权限。程序检查敏感字面量和复制内容，并由独立模型复核；这些检查不能保证绝对匿名。'),
   h('p',null,'超过 '+fmt(state?.config?.harvestSourceChars||120000)+' 字的来源会跳过，不截断后猜测。每日最多 '+(info?.today?.limit??4)+' 次提炼，最多暂存 2 项。题库最多保存 20 组，每次选取 2 组，优先覆盖尚未检查的样例。'),
   h('p',null,'服务故障后至少等待 1 小时再试。关闭宿主会丢弃未完成的内存任务；已审核入库的样例仍保留。页面每 5 秒只读刷新。')),
  entries.length?h('details',{className:'dcc-more'},h('summary',null,'已入库样例的审核记录（'+entries.length+'）'),
   ...entries.map(entry=>h('p',{key:entry.id},clock(entry.createdAt)+' · '+entry.id+' · '+modelNames(entry.models)))):null,
  h('button',{type:'button',className:'dcc-btn',disabled:!info||!info.approvedCount||info.running||state?.replay?.running,onClick:()=>onAction('clear-learned-cases')},'清空动态题库（保留当前策略）'));
}
function Panel(){
 const [state,setState]=R.useState(null),[draft,setDraft]=R.useState(null),[loadError,setLoadError]=R.useState('');
 const [tab,setTab]=R.useState('settings'),[saving,setSaving]=R.useState(false),[flash,setFlash]=R.useState(null);
 const baseRef=R.useRef(null),draftRef=R.useRef(null);draftRef.current=draft;
 const sequence=R.useRef(0),pendingSave=R.useRef(false);
 async function refresh(){
  if(pendingSave.current)return;
  const version=++sequence.current;
  try{
   const r=await fetch(API,{cache:'no-store'});const s=await r.json();if(!r.ok)throw Error(s.error||'HTTP '+r.status);
   if(version!==sequence.current)return;
   const next=toDraft(s.config),cur=draftRef.current,prev=baseRef.current;
   setState(s);setLoadError('');
   const edited=cur&&prev?changedKeys(cur,prev):[];
   setDraft({...next,...Object.fromEntries(edited.map(k=>[k,cur[k]]))});
   for(const k of edited)next[k]=prev[k];
   baseRef.current=next;
  }catch(e){if(version===sequence.current)setLoadError(e.message||'读取失败');}
 }
 R.useEffect(()=>{refresh();const t=setInterval(refresh,5000);return()=>clearInterval(t);},[]);
 R.useEffect(()=>{if(flash?.tone!=='ok')return;const t=setTimeout(()=>setFlash(null),6000);return()=>clearTimeout(t);},[flash]);
 const set=(k,v)=>{setFlash(null);setDraft(d=>({...d,[k]:v}));};
 const base=baseRef.current,changes=changedKeys(draft,base),errors=draft?Object.keys(draft).filter(k=>check(k,draft[k])):[];
 async function save(){
  if(!state||errors.length||pendingSave.current)return;pendingSave.current=true;sequence.current++;setSaving(true);setFlash(null);
  try{
   const r=await fetch(API,{method:'POST',headers:{'content-type':'application/json','x-dsh-compaction-csrf':state.csrf},body:JSON.stringify({changes:Object.fromEntries(changes.map(k=>[k,fromDraft(draft)[k]])),expected:Object.fromEntries(changes.map(k=>[k,fromDraft(base)[k]]))})});
   const s=await r.json();if(!r.ok)throw Error(s.error||'HTTP '+r.status);
   const next=toDraft(s.config);baseRef.current=next;setState(s);setDraft(current=>({...next,...Object.fromEntries(changedKeys(current,draft).map(k=>[k,current[k]]))}));
   setFlash({tone:'ok',text:'已保存。之后的压缩使用新设置，正在进行的压缩不受影响。'});
  }catch(e){setFlash({tone:'bad',text:'没有保存：'+(e.message||'请求失败')});}
  finally{pendingSave.current=false;setSaving(false);}
 }
 async function replay(action="run-fixture-replay"){
  try{const response=await fetch(API,{method:'POST',headers:{'content-type':'application/json','x-dsh-compaction-csrf':state.csrf},body:JSON.stringify({action,version:state.replay?.policy?.active?.version})});
   const value=await response.json();if(!response.ok)throw Error(value.error||'请求失败');setState(value);}
  catch(e){setFlash({tone:'bad',text:e.message});}
 }
 const [tone,healthText]=healthOf(state,loadError);
 const runs=state?.runs||[];
 const failed=runs.filter(r=>r.status==='failed').length;
 return h('section',{className:'dcc','aria-labelledby':'dcc-title'},
  h('style',null,CSS),
  h('header',{className:'dcc-head'},
   h('div',null,h('h2',{className:'dcc-title',id:'dcc-title'},'多模型协作压缩'),
    h('p',{className:'dcc-lede'},'压缩会话上下文时，由几个模型分工写摘要、互相审核并核对事实，全部通过才写回会话。')),
   h('div',{className:'dcc-headside'},
    h('span',{className:'dcc-pill dcc-tone-'+tone,title:state?.health||loadError||''},h('span',{className:'dcc-dot'}),h('span',null,healthText)),
    draft?h('label',{className:'dcc-master'},h(Switch,{large:true,checked:!!draft.enabled,label:'启用协作压缩',onChange:v=>set('enabled',v)}),draft.enabled?'已启用':'已关闭'):null)),
  !draft?h('div',{className:'dcc-loading'},loadError?h(R.Fragment,null,'读取设置失败：'+loadError+'。确认 DSH 已加载本插件后 ',h('button',{type:'button',className:'dcc-btn-text',onClick:refresh},'重试')):'正在读取设置…'):
  h(R.Fragment,null,
   h(Flow,{d:draft,set,saved:base?String(base.enabled)===String(draft.enabled):true}),
   h(PolicyScope,{scope:state?.replay?.scope}),
   h('details',{className:'dcc-more'},h('summary',null,'历史原文检索 · SQLite 全文索引'),
    h('p',null,'search_context 可定位压缩前的原始记录、摘要和附件说明。两字人名使用短词索引，刚发送但尚未保存的消息也参与本轮检索。命中后可继续读取原文。'),
    h('p',null,'首次查询会建立可重建的本地索引，之后按记录变化更新；查询在工作线程运行。索引故障会明确提示搜索未完成，不代表原文不存在。搜索本身不调用外部模型。')),
   h('p',{className:'dcc-lede'},state?.retrieval?.enabled===true?'大工具结果按需取回已配置。Anthropic / OpenAI Chat Completions 插件通道从 '+state.retrieval.minToolTokens+' tokens 起可保留原件，以 '+state.retrieval.tool+' 取回。Responses 浏览器任务通过 browser_progress 查看证据。':state?.retrieval?.enabled===false?'大工具结果按需取回未开启。':'大工具结果取回配置暂未读到。'),
   h('details',{className:'dcc-more'},h('summary',null,'三路回放与自动压缩策略'),
    h('label',{className:'dcc-master'},h(Switch,{checked:!!draft.replayFeedbackEnabled,label:'回放验证后自动应用压缩策略',onChange:v=>set('replayFeedbackEnabled',v)}),'回放验证后自动应用'),
    h('p',null,'开启后先在后台小批初始化，保存每个完成的步骤；达到调用、token 或时间预算就暂停，下一次窗口接着进行。现行策略存在可复现遗漏时，模型再提出新条款，完成独立审核、重复对照和无退步检查后才采用。常规完成窗口为七天，新样例窗口为 24 小时；暂停和技术失败都不算完成。'),
    h(ReplayProgress,{replay:state?.replay,calibration:state?.calibration,enabled:state?.config?.replayFeedbackEnabled,config:state?.config}),
    h('p',null,'当前实际策略 v'+(state?.replay?.effectivePolicy?.version??0)+' · 预设条款 '+(state?.replay?.effectivePolicy?.rules?.length||0)+' 条 · 模型提出的条款 '+(state?.replay?.effectivePolicy?.clauses?.length||0)+' 条'),
    state?.replay?.effectivePolicy?.rules?.length?h('p',null,'预设条款 · '+state.replay.effectivePolicy.rules.join(' / ')):null,
    ...(state?.replay?.effectivePolicy?.clauses||[]).map(clause=>h('details',{className:'dcc-more',key:clause.id},h('summary',null,'新条款 · '+clause.when),
      h('p',null,'保留内容 · '+clause.retain.join('、')),h('p',null,'需要保留的关系 · '+clause.relation),h('small',null,'条款编号 '+clause.id))),
    state?.replay?.effectivePolicy?.proof?h('details',null,h('summary',null,'当前策略采用时的验证记录'),h('pre',{className:'dcc-raw'},JSON.stringify(state.replay.effectivePolicy.proof,null,2))):null,
    state?.replay?.policy?.last?h('p',null,clock(state.replay.policy.last.at)+' · '+state.replay.policy.last.reason+(state.replay.policy.last.clauseReviewer?' · 配置的审核模型 '+state.replay.policy.last.clauseReviewer:'')):null,
    state?.replay?.policy?.last?.gates?.repeatable?h('p',null,'重复验证：'+(state.replay.policy.last.gates.repeatable.passed?'通过':'未通过')+' · 至少两次重生成，旧策略目标题须两次失败，新策略目标题及留出正例、反例须两次通过。'):null,
    state?.replay?.policy?.last?.before?h('details',null,h('summary',null,'查看旧策略与候选的逐项证据'),h('pre',{className:'dcc-raw'},JSON.stringify({before:state.replay.policy.last.before,after:state.replay.policy.last.after,gates:state.replay.policy.last.gates,proposed:state.replay.policy.last.proposed},null,2))):null,
    state?.replay?.policy?.previous?h('button',{className:'dcc-btn',disabled:state.replay.running,onClick:()=>replay('rollback-replay-policy')},'恢复上一策略'):null,
    h('p',null,'动态题库会参与后续回放，也可在本插件数据目录放置 feedback-cases.json 添加问题及独立留出题，格式见 README。样例会提交给配置的模型；页面刷新只读取结果。通过验证的条款从下一次压缩开始使用。'),
    h('button',{className:'dcc-btn',disabled:!state?.config?.enabled||state?.replay?.running,onClick:()=>replay()},state?.replay?.running?'正在回放…':state?.config?.replayFeedbackEnabled?'继续 / 开始校准':'运行三路诊断（不启用自动校准）'),
    state?.config?.replayFeedbackEnabled?h('p',{className:'dcc-hint'},'手动继续同样遵守每日预算；恢复不会把已完成的同一轮任务重新计作独立验证。'):null,
    state?.replay?.error?h('p',null,state.replay.error):null,
    state?.replay?.report?h('p',null,state.replay.report.provider+' / '+state.replay.report.model+' · '+clock(state.replay.report.at)):null,
    ...(state?.replay?.report?.probes||[]).map(p=>h('p',{key:p.id},(replayLabels[p.id]||p.id)+' · '+(replayLabels[p.classification]||p.classification)+' · '+['full','summary','retrieval'].map((k,i)=>['原文','摘要','可回查'][i]+(p.lanes[k].pass?'通过':p.lanes[k].error?'出错':'未通过')).join(' / '))),
    h(HarvestBank,{state,draft,set,onAction:replay})),
   h('div',{className:'dcc-tabs',role:'tablist'},
    h('button',{type:'button',role:'tab',id:'dcc-tab-settings','aria-selected':tab==='settings'?'true':'false','aria-controls':'dcc-panel-settings',className:'dcc-tab',onClick:()=>setTab('settings')},'设置',changes.length?h('span',{className:'dcc-count'},`${changes.length} 项未保存`):null),
    h('button',{type:'button',role:'tab',id:'dcc-tab-runs','aria-selected':tab==='runs'?'true':'false','aria-controls':'dcc-panel-runs',className:'dcc-tab',onClick:()=>setTab('runs')},'运行记录',failed?h('span',{className:'dcc-count dcc-tone-bad'},`${failed} 次失败`):null)),
   h('div',{role:'tabpanel',id:'dcc-panel-'+tab,'aria-labelledby':'dcc-tab-'+tab},
    tab==='settings'?h(Settings,{draft,base,set}):h(Runs,{runs,notice:state?.notice,onRefresh:refresh})),
   flash&&!changes.length?h('div',{className:'dcc-flash dcc-tone-'+flash.tone,role:'status'},flash.text):null,
   changes.length||(flash&&flash.tone==='bad')?h('div',{className:'dcc-bar',role:'region','aria-label':'未保存的更改'},
    h('div',{className:'dcc-bar-text',role:'status'},flash?.tone==='bad'?flash.text:errors.length?h(R.Fragment,null,h('strong',null,`${errors.length} 项需要修改`),'，改好后才能保存'):h(R.Fragment,null,h('strong',null,`${changes.length} 项更改`),'尚未保存')),
    h('button',{type:'button',className:'dcc-btn dcc-btn-ghost',disabled:saving,onClick:()=>{setDraft(baseRef.current);setFlash(null);}},'放弃更改'),
    h('button',{type:'button',className:'dcc-btn dcc-btn-primary',disabled:saving||errors.length>0||!changes.length,onClick:save},saving?'正在保存…':'保存设置')):null));
}

return {inject:['slots'],apply(ctx){const s=ctx.get('slots');s.inject('settings.section',()=>s.register({name:'settings.section',id:'collaborative-compaction',order:58,label:()=> '多模型协作压缩'},Panel));}};
}});
