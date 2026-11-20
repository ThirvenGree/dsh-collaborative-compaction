// Account failures must stop the whole pipeline before paid selection/review calls.
// A hard context threshold cannot restore an exhausted or unauthorized account.
export function createProviderHealth({read,write,now=Date.now}) {
 const key=c=>JSON.stringify([c.aProvider,c.aModel]);
 const current=c=>{const s=read();return s?.key===key(c)&&s.blocked?s:null;};
 return {
  current,
  assert(c){const s=current(c);if(s)throw Object.assign(Error('摘要 A 已暂停：'+s.message+'；恢复账户后在设置页点击“重新检查摘要 A”'),{code:'SUMMARY_ACCOUNT_BLOCKED'});},
  failure(c,reason){
   const f=reason?.failure||{},status=Number(f.status||f.statusCode||f.httpStatus);
   if(![401,402,403].includes(status)&&f.code!=='ACCOUNT_QUOTA')return;
   const message=String(f.message||f.code||'Account unavailable').replace(/(?:sk-[\w-]+|Bearer\s+[^\s"]+|AIza[\w-]+)/gi,'[redacted]').slice(0,300);
   write({key:key(c),provider:c.aProvider,model:c.aModel,blocked:true,status,code:f.code,at:now(),message});
  },
  clear(c){if(current(c))write({blocked:false,at:now()});}
 };
}
