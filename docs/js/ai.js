// المساعد الذكي — Gemini أو Claude، المفتاح محفوظ بموبايل الطبيب فقط
(function(){
const SYSTEM = `You are a clinical decision-support assistant for a licensed general practitioner in Iraq.
The doctor makes all final decisions. Be accurate, conservative and evidence-based.
- Consider common conditions in Iraq/Middle East and seasonal/endemic disease (e.g. typhoid, brucellosis, leishmaniasis, cholera, hepatitis A) when relevant.
- Always list red flags and say clearly when urgent referral/emergency is needed.
- Medicines: use generic names available in Iraq, adult or weight-based pediatric doses, and respect allergies, pregnancy, breastfeeding, age, kidney/liver disease and current medications.
- Write explanations in Iraqi-friendly Modern Standard Arabic; keep diagnosis and drug names in English.
- Return ONLY valid JSON, no markdown.`;

const ANALYZE_SCHEMA = `{
 "summary": "ملخص الحالة بسطرين",
 "attachment_findings": ["ما يظهر في المرفقات (تحاليل/صور) مع القيم غير الطبيعية"],
 "urgent": false,
 "urgent_reason": "",
 "red_flags": ["علامات خطر يجب الانتباه لها"],
 "questions_to_ask": ["أسئلة أو فحوصات سريرية تساعد بالتشخيص"],
 "differentials": [
   {"name":"Diagnosis in English","name_ar":"بالعربي","likelihood":"high|medium|low",
    "reasoning":"لماذا", "suggested_tests":["CBC", "..."],
    "treatment":{"drugs":[{"generic":"Amoxicillin","strength":"500 mg Cap","sig_ar":"كبسولة كل 8 ساعات","duration_ar":"7 أيام"}],
                 "advice_ar":["نصائح للمريض"]}}
 ]
}
Give 3-5 differentials ordered by likelihood.`;

const CHECK_SCHEMA = `{"ok": true, "issues":[{"severity":"high|medium|low","message_ar":"..."}], "suggestions_ar":["..."]}`;

function cfg(){ return window.App.settings(); }

function patientBlock(p){
  const lines = [];
  lines.push(`Age: ${p.ageText||'unknown'}; Sex: ${p.sex||'unknown'}; Weight: ${p.weight? p.weight+' kg':'unknown'}`);
  if(p.pregnant) lines.push('Pregnant: yes' + (p.pregWeeks? ` (${p.pregWeeks} weeks)`:''));
  if(p.breastfeeding) lines.push('Breastfeeding: yes');
  const al = (p.allergyNames||[]).concat(p.allergyText?[p.allergyText]:[]);
  lines.push('Allergies: '+(al.length? al.join(', '):'none known'));
  if(p.chronic) lines.push('Chronic diseases: '+p.chronic);
  if(p.currentMeds) lines.push('Current medications: '+p.currentMeds);
  const v = p.vitals||{}; const vs=[];
  if(v.temp) vs.push('Temp '+v.temp+'°C'); if(v.bp) vs.push('BP '+v.bp); if(v.pulse) vs.push('Pulse '+v.pulse);
  if(v.rr) vs.push('RR '+v.rr); if(v.spo2) vs.push('SpO2 '+v.spo2+'%'); if(v.sugar) vs.push('RBS '+v.sugar+' mg/dl');
  if(vs.length) lines.push('Vitals: '+vs.join(', '));
  if(p.symptoms) lines.push('Symptoms / history: '+p.symptoms);
  if(p.exam) lines.push('Examination findings: '+p.exam);
  return lines.join('\n');
}

function parseJSON(t){
  t = (t||'').trim().replace(/^```(?:json)?/i,'').replace(/```$/,'').trim();
  const a=t.indexOf('{'), b=t.lastIndexOf('}');
  if(a>=0&&b>a) t=t.slice(a,b+1);
  return JSON.parse(t);
}

const GBASE = 'https://generativelanguage.googleapis.com/v1beta';
const sleep = ms=>new Promise(r=>setTimeout(r,ms));
const isBusy = (st,msg)=> st===503 || st===429 || st===500 || /high demand|overloaded|UNAVAILABLE|try again later|RESOURCE_EXHAUSTED/i.test(msg||'');

async function geminiOnce(model, prompt, files){
  const c = cfg();
  const parts = [{text: prompt}];
  (files||[]).forEach(f=>parts.push({inline_data:{mime_type:f.mime, data:f.data}}));
  const res = await fetch(`${GBASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(c.apiKey)}`,{
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({
      systemInstruction:{parts:[{text:SYSTEM}]},
      contents:[{role:'user',parts}],
      generationConfig:{temperature:0.2, responseMimeType:'application/json'}
    })
  });
  const j = await res.json().catch(()=>({}));
  if(!res.ok) return {ok:false, status:res.status, msg: j.error?.message || ('HTTP '+res.status)};
  const txt = (j.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join('');
  if(!txt) return {ok:false, status:0, msg:'لم يرجع رد من Gemini'};
  return {ok:true, txt};
}

// نماذج بديلة متاحة لهذا المفتاح (عند ازدحام النموذج الأساسي)
async function geminiAlternatives(exclude){
  try{
    const res = await fetch(`${GBASE}/models?pageSize=200&key=${encodeURIComponent(cfg().apiKey)}`);
    const j = await res.json();
    const ver = n=>parseFloat((n.match(/(\d+(?:\.\d+)?)/)||[0,0])[1]);
    return (j.models||[])
      .filter(m=>(m.supportedGenerationMethods||[]).includes('generateContent'))
      .map(m=>m.name.replace(/^models\//,''))
      .filter(n=>/^gemini-/.test(n) && /flash|pro/.test(n) && !/image|tts|audio|live|embed|robotics|computer|native|exp/i.test(n) && n!==exclude)
      .sort((a,b)=> (/flash/.test(b)-/flash/.test(a)) || (/preview/.test(a)-/preview/.test(b)) || (ver(b)-ver(a)))
      .slice(0,4);
  }catch(e){ return []; }
}

async function callGemini(prompt, files){
  const c = cfg();
  let model = c.geminiModel || 'gemini-3.8-flash';
  let r = await geminiOnce(model, prompt, files);
  // النموذج انتهى: Google يذكر البديل — نحوّل له ونحفظه
  if(!r.ok){
    const m = r.msg.match(/use\s+models\/([\w.\-]+)/i);
    if(m && m[1]!==model){ model = m[1]; c.geminiModel = model; window.App.saveSettings(); r = await geminiOnce(model, prompt, files); }
  }
  // ازدحام: إعادة محاولة ثم نماذج بديلة
  if(!r.ok && isBusy(r.status, r.msg)){
    window.App.status && window.App.status('الخدمة مزدحمة، جاري إعادة المحاولة…');
    await sleep(2500);
    r = await geminiOnce(model, prompt, files);
    if(!r.ok && isBusy(r.status, r.msg)){
      for(const alt of await geminiAlternatives(model)){
        window.App.status && window.App.status('جاري المحاولة بنموذج بديل: '+alt);
        const r2 = await geminiOnce(alt, prompt, files);
        if(r2.ok){ r = r2; break; }
      }
    }
  }
  if(!r.ok) throw new Error(r.msg);
  return r.txt;
}

async function callClaude(prompt, files){
  const c = cfg();
  const model = c.claudeModel || 'claude-sonnet-5-5';
  const content = [];
  (files||[]).forEach(f=>{
    if(f.mime==='application/pdf') content.push({type:'document',source:{type:'base64',media_type:'application/pdf',data:f.data}});
    else content.push({type:'image',source:{type:'base64',media_type:f.mime,data:f.data}});
  });
  content.push({type:'text',text:prompt});
  const send = ()=>fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{'Content-Type':'application/json','x-api-key':c.apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
    body: JSON.stringify({model, max_tokens:4000, system:SYSTEM, messages:[{role:'user',content}]})
  });
  let res = await send(); let j = await res.json().catch(()=>({}));
  for(let i=0; i<2 && !res.ok && (res.status===529||isBusy(res.status, j.error?.message)); i++){
    window.App.status && window.App.status('الخدمة مزدحمة، جاري إعادة المحاولة…');
    await sleep(3000*(i+1)); res = await send(); j = await res.json().catch(()=>({}));
  }
  if(!res.ok) throw new Error(j.error?.message || ('HTTP '+res.status));
  return (j.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
}

async function call(prompt, files){
  const c = cfg();
  if(!c.apiKey) throw new Error('NO_KEY');
  if(!navigator.onLine) throw new Error('لا يوجد اتصال بالإنترنت');
  const txt = c.provider==='claude' ? await callClaude(prompt, files) : await callGemini(prompt, files);
  return parseJSON(txt);
}

async function analyze(patient, files){
  const prompt = `PATIENT (name withheld for privacy):\n${patientBlock(patient)}\n\n`+
    (files&&files.length? `${files.length} attachment(s) are included (lab reports, images, documents). Read them carefully; for X-ray/ECG/scan images give only a preliminary reading and say it needs specialist confirmation.\n\n`:'')+
    `Return JSON exactly in this shape:\n${ANALYZE_SCHEMA}`;
  return call(prompt, files);
}

async function checkRx(patient, diagnosis, rxLines){
  const prompt = `PATIENT:\n${patientBlock(patient)}\nWorking diagnosis: ${diagnosis||'not stated'}\n\nPRESCRIPTION:\n${rxLines.map((l,i)=>`${i+1}. ${l}`).join('\n')}\n\n`+
  `Review this prescription for safety: wrong doses (especially weight-based pediatric doses), interactions, contraindications, allergy conflicts, pregnancy/lactation safety, duplications, missing essential treatment. Return JSON: ${CHECK_SCHEMA}`;
  return call(prompt, []);
}

async function testKey(){
  return call('Reply with JSON {"ok":true}', []);
}

window.AI = {analyze, checkRx, testKey};
})();
