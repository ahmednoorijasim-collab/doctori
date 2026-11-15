// دكتوري — التطبيق الرئيسي. بيانات المرضى بالذاكرة فقط ولا تُحفظ أبداً.
(function(){
const $ = s=>document.querySelector(s);
const $$ = s=>Array.from(document.querySelectorAll(s));
const esc = s=>(s==null?'':String(s)).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let uidN = 0; const uid = ()=>'i'+(++uidN);

// ================= تخزين إعدادات الطبيب فقط =================
const LS = {
  get(k,d){ try{ const v=localStorage.getItem('doctori.'+k); return v?JSON.parse(v):d; }catch(e){ return d; } },
  set(k,v){ try{ localStorage.setItem('doctori.'+k, JSON.stringify(v)); }catch(e){ toast('تعذر الحفظ — الذاكرة ممتلئة؟'); } }
};
const DEF_SET = {nameAr:'',nameEn:'',specAr:'',specEn:'',addr:'',phone:'',hours:'',logo:'',sig:'',provider:'gemini',apiKey:'',geminiModel:'gemini-3.8-flash',claudeModel:'claude-sonnet-5-5',showDx:false};
let settings = Object.assign({}, DEF_SET, LS.get('settings',{}));
if(settings.geminiModel==='gemini-2.5-flash') settings.geminiModel=DEF_SET.geminiModel;
const saveSettings = ()=>LS.set('settings',settings);
let templates = LS.get('templates', null);
let customDrugs = LS.get('customDrugs', []);
window.customDrugs = ()=>customDrugs;

const STARTER_TPL = [
  {name:'التهاب لوزتين بكتيري (بالغ)',dx:'Acute bacterial tonsillitis',items:[{id:'amox500',dur:'10 أيام'},{id:'para500'}],advice:'غرغرة بماء دافئ وملح، الإكثار من السوائل، الراحة'},
  {name:'التهاب لوزتين (طفل)',dx:'Acute tonsillitis',items:[{id:'amoxsyr',dur:'10 أيام'},{id:'parasyr250'}],advice:'سوائل دافئة، راحة، مراجعة عند صعوبة البلع أو استمرار الحرارة أكثر من 3 أيام'},
  {name:'نزلة برد',dx:'Common cold (URTI)',items:[{id:'para500'},{id:'saline'},{id:'cetir10',dur:'5 أيام'}],advice:'سوائل دافئة، راحة، لا حاجة لمضاد حيوي'},
  {name:'التهاب مجاري بولية بسيط (امرأة غير حامل)',dx:'Uncomplicated cystitis',items:[{id:'nitro100'},{id:'para500'}],advice:'الإكثار من شرب الماء، مراجعة عند الحرارة أو ألم الخاصرة'},
  {name:'حموضة والتهاب معدة',dx:'Gastritis / GERD',items:[{id:'omep20'},{id:'gaviscon'}],advice:'تجنب الأكل الدسم والحار والمنبهات، عدم الاستلقاء بعد الأكل بساعتين'},
  {name:'إسهال حاد (طفل)',dx:'Acute gastroenteritis',items:[{id:'ors'},{id:'zinc'},{id:'parasyr250'}],advice:'الاستمرار بالرضاعة والأكل، مراجعة فوراً عند الخمول أو قلة البول أو دم بالخروج'},
];
if(!templates){ templates = STARTER_TPL; LS.set('templates',templates); }

function allDrugs(){ return window.DRUGS.concat(customDrugs); }
function drugById(id){ return allDrugs().find(d=>d.id===id); }

// ================= حالة المريض (ذاكرة فقط) =================
let P, files, aiResult, rx, selectedDx;
function resetState(){
  P = {sex:'',allergies:[]}; files=[]; aiResult=null; rx=[]; selectedDx=null;
}
resetState();

// ================= أدوات =================
let toastT;
function toast(m){ const t=$('#toast'); t.textContent=m; t.classList.add('on'); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('on'),2600); }
function openM(id){ $(id).classList.add('on'); }
function closeM(el){ el.closest('.modal').classList.remove('on'); }
$$('.modal').forEach(m=>m.addEventListener('click',e=>{ if(e.target===m || e.target.hasAttribute('data-close')) m.classList.remove('on'); }));

function go(tab){
  $$('section.tab').forEach(s=>s.classList.toggle('on', s.id==='tab-'+tab));
  $$('nav.bottom button').forEach(b=>b.classList.toggle('on', b.dataset.go===tab));
  window.scrollTo({top:0});
  if(tab==='rx') renderRx();
}
$$('[data-go]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.go)));

function busy(btn, on, txt){
  if(on){ btn.dataset.t = btn.innerHTML; btn.disabled=true; btn.innerHTML = `<span class="spinner"></span> ${txt||'جاري…'}`; }
  else { btn.disabled=false; if(btn.dataset.t) btn.innerHTML = btn.dataset.t; }
}

// ================= قراءة بيانات المريض =================
function num(id){ const v=parseFloat($(id).value); return isNaN(v)?null:v; }
function readPatient(){
  const y=num('#pAgeY'), m=num('#pAgeM');
  P.name = $('#pName').value.trim();
  P.ageMonths = (y==null&&m==null)? null : Math.round((y||0)*12+(m||0));
  P.ageText = P.ageMonths==null? '' : (P.ageMonths<24 ? `${P.ageMonths} months` : `${y||0} years${m?` ${m} months`:''}`);
  P.ageAr = P.ageMonths==null? '' : (P.ageMonths<24 ? `${P.ageMonths} شهر` : `${y||0} سنة${m?` و${m} شهر`:''}`);
  P.weight = num('#pWeight');
  const fem = P.sex==='female';
  P.pregnant = fem && $('#pPreg').checked;
  P.pregWeeks = P.pregnant? num('#pPregW') : null;
  P.breastfeeding = fem && $('#pBreast').checked;
  P.allergyText = $('#pAllergyText').value.trim();
  P.allergyNames = P.allergies.map(a=>(window.ALLERGY_GROUPS.find(g=>g.id===a)||{}).ar||a);
  P.chronic = $('#pChronic').value.trim();
  P.currentMeds = $('#pMeds').value.trim();
  P.vitals = {temp:$('#vTemp').value.trim(),bp:$('#vBp').value.trim(),pulse:$('#vPulse').value.trim(),rr:$('#vRr').value.trim(),spo2:$('#vSpo2').value.trim(),sugar:$('#vSugar').value.trim()};
  P.symptoms = $('#dSymptoms').value.trim();
  P.exam = $('#dExam').value.trim();
  return P;
}
const isChild = ()=> P.ageMonths!=null && P.ageMonths < 144;

// الجنس
$$('#pSex button').forEach(b=>b.addEventListener('click',()=>{
  P.sex = b.dataset.v;
  $$('#pSex button').forEach(x=>x.classList.toggle('on',x===b));
  $('#femaleBox').style.display = P.sex==='female' ? '' : 'none';
  refreshWarnings();
}));
$('#pPreg').addEventListener('change',()=>{ $('#pregWeeksBox').style.display = $('#pPreg').checked?'':'none'; refreshWarnings(); });

// الحساسية
function renderAllergyChips(){
  $('#allergyChips').innerHTML = window.ALLERGY_GROUPS.map(g=>`<button class="chip ${P.allergies.includes(g.id)?'on':''}" data-a="${g.id}">${esc(g.ar)}</button>`).join('');
}
$('#allergyChips').addEventListener('click',e=>{
  const b=e.target.closest('[data-a]'); if(!b) return;
  const a=b.dataset.a; const i=P.allergies.indexOf(a);
  if(i>=0) P.allergies.splice(i,1); else P.allergies.push(a);
  renderAllergyChips(); refreshWarnings();
});
['#pAgeY','#pAgeM','#pWeight','#pAllergyText','#pMeds','#pBreast'].forEach(id=>$(id).addEventListener('change',()=>{ readPatient(); recalcPeds(); refreshWarnings(); }));

// ================= الإدخال الصوتي (إن توفر) =================
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if(SR){
  $$('.mic').forEach(b=>b.style.display='');
  $('#micHint').style.display='none';
  let rec=null, recBtn=null;
  $$('.mic').forEach(b=>b.addEventListener('click',()=>{
    if(rec){ rec.stop(); return; }
    try{
      rec = new SR(); rec.lang='ar-IQ'; rec.interimResults=false; rec.continuous=true;
      const ta = $('#'+b.dataset.mic); recBtn=b; b.classList.add('rec'); b.textContent='⏹ إيقاف';
      rec.onresult = ev=>{ for(let i=ev.resultIndex;i<ev.results.length;i++){ if(ev.results[i].isFinal) ta.value = (ta.value?ta.value+' ':'')+ev.results[i][0].transcript; } };
      rec.onend = ()=>{ recBtn.classList.remove('rec'); recBtn.textContent='🎤 تكلّم'; rec=null; };
      rec.onerror = ()=>toast('تعذر تشغيل المايك — استخدم مايك الكيبورد');
      rec.start();
    }catch(e){ rec=null; toast('الإدخال الصوتي غير مدعوم هنا'); }
  }));
}

// ================= المرفقات =================
function readAsDataURL(file){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file); }); }
function loadImg(src){ return new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=src; }); }
async function shrinkImage(dataUrl, max=1600, q=0.85){
  const img = await loadImg(dataUrl);
  const s = Math.min(1, max/Math.max(img.width,img.height));
  const c = document.createElement('canvas'); c.width=Math.round(img.width*s); c.height=Math.round(img.height*s);
  c.getContext('2d').drawImage(img,0,0,c.width,c.height);
  return c.toDataURL('image/jpeg', q);
}
async function addFiles(list){
  for(const f of Array.from(list||[])){
    try{
      if(f.type==='application/pdf'){
        if(f.size > 15*1024*1024){ toast('ملف PDF كبير جداً (أكثر من 15MB)'); continue; }
        const d = await readAsDataURL(f);
        files.push({id:uid(), name:f.name, mime:'application/pdf', data:d.split(',')[1], preview:null});
      } else if(f.type.startsWith('image/')){
        const d = await shrinkImage(await readAsDataURL(f));
        files.push({id:uid(), name:f.name, mime:'image/jpeg', data:d.split(',')[1], preview:d});
      } else toast('نوع الملف غير مدعوم: '+f.name);
    }catch(e){ toast('تعذر قراءة الملف'); }
  }
  renderThumbs();
}
function renderThumbs(){
  $('#thumbs').innerHTML = files.map(f=>`<div class="thumb">${f.preview?`<img src="${f.preview}">`:`<span>📄<br>${esc(f.name.slice(0,18))}</span>`}<button data-del="${f.id}">✕</button></div>`).join('');
}
$('#thumbs').addEventListener('click',e=>{ const b=e.target.closest('[data-del]'); if(!b) return; files=files.filter(f=>f.id!==b.dataset.del); renderThumbs(); });
['#fileCam','#filePick'].forEach(id=>$(id).addEventListener('change',e=>{ addFiles(e.target.files); e.target.value=''; }));

// ================= التحليل الذكي =================
function aiErr(e){
  if(e.message==='NO_KEY'){ toast('أضف مفتاح الذكاء الاصطناعي من الإعدادات أولاً'); go('set'); $('#sKey').focus(); return; }
  let m = e.message||String(e);
  if(/API key|API_KEY|invalid x-api-key|authentication/i.test(m)) m='المفتاح غير صحيح — راجع الإعدادات';
  else if(/quota|rate|429|overloaded/i.test(m)) m='تم تجاوز حد الاستخدام مؤقتاً، حاول بعد دقيقة';
  else if(/Failed to fetch|NetworkError|Load failed/i.test(m)) m='تعذر الاتصال — تأكد من الإنترنت';
  else if(/JSON/i.test(m)) m='الرد غير مكتمل، حاول مرة ثانية';
  toast('⚠️ '+m);
}

$('#btnAnalyze').addEventListener('click', async ()=>{
  readPatient();
  if(!P.symptoms && !P.exam && !files.length){ toast('اكتب الأعراض أو أضف مرفق أولاً'); return; }
  const btn = $('#btnAnalyze'); busy(btn,true,'جاري التحليل…');
  try{
    aiResult = await window.AI.analyze(P, files);
    selectedDx = null;
    renderAI();
    setTimeout(()=>$('#aiOut').scrollIntoView({behavior:'smooth',block:'start'}),100);
  }catch(e){ aiErr(e); }
  busy(btn,false);
});

function li(arr){ return (arr||[]).filter(Boolean).map(x=>`<li>${esc(x)}</li>`).join(''); }
const LK = {high:'احتمال عالي',medium:'احتمال متوسط',low:'احتمال قليل'};
function renderAI(){
  const r = aiResult; if(!r){ $('#aiOut').innerHTML=''; return; }
  let h = '';
  if(r.urgent) h += `<div class="note danger"><b>🚨 حالة طارئة محتملة:</b> ${esc(r.urgent_reason||'')}</div>`;
  h += `<div class="card"><h2>📋 ملخص الحالة</h2><div>${esc(r.summary||'')}</div>`;
  if((r.attachment_findings||[]).length) h += `<h3>📎 من المرفقات</h3><ul class="plain">${li(r.attachment_findings)}</ul>`;
  if((r.red_flags||[]).length) h += `<h3 style="color:var(--red)">🚩 علامات خطر</h3><ul class="plain">${li(r.red_flags)}</ul>`;
  if((r.questions_to_ask||[]).length) h += `<h3>❓ أسئلة وفحوصات تساعد</h3><ul class="plain">${li(r.questions_to_ask)}</ul>`;
  h += `</div><div class="card"><h2>🧠 التشخيصات المحتملة</h2>`;
  (r.differentials||[]).forEach((d,i)=>{
    const tr = d.treatment||{};
    h += `<div class="dx ${selectedDx===i?'sel':''}">
      <div class="t"><span class="n ltr">${esc(d.name)}</span><span class="lk ${esc(d.likelihood)}">${LK[d.likelihood]||esc(d.likelihood||'')}</span></div>
      ${d.name_ar?`<div class="muted">${esc(d.name_ar)}</div>`:''}
      <div style="font-size:13.5px;margin-top:4px">${esc(d.reasoning||'')}</div>
      ${(d.suggested_tests||[]).length?`<div style="font-size:13px;margin-top:4px"><b>🧪 فحوصات:</b> <span class="ltr">${esc(d.suggested_tests.join(', '))}</span></div>`:''}
      ${(tr.drugs||[]).length?`<div style="font-size:13px;margin-top:6px"><b>💊 علاج مقترح:</b><ul>${tr.drugs.map(x=>`<li><span class="ltr">${esc(x.generic)} ${esc(x.strength||'')}</span> — ${esc(x.sig_ar||'')} ${x.duration_ar?'('+esc(x.duration_ar)+')':''}</li>`).join('')}</ul></div>`:''}
      <div class="acts">
        <button class="btn small" data-dx="${i}">✔️ اعتماد التشخيص</button>
        ${(tr.drugs||[]).length?`<button class="btn small ghost" data-dxrx="${i}">💊 اعتماد + إضافة العلاج للوصفة</button>`:''}
      </div></div>`;
  });
  h += `<div class="muted">⚕️ هذه اقتراحات مساعدة فقط ويجب أن يتأكد منها الطبيب.</div></div>`;
  $('#aiOut').innerHTML = h;
}
$('#aiOut').addEventListener('click',e=>{
  const a=e.target.closest('[data-dx]'), b=e.target.closest('[data-dxrx]');
  if(!a&&!b) return;
  const i = +(a?a.dataset.dx:b.dataset.dxrx); const d = aiResult.differentials[i];
  selectedDx = i; $('#rxDx').value = d.name;
  if(b){
    const tr=d.treatment||{}; let n=0;
    (tr.drugs||[]).forEach(x=>{ addFromAI(x); n++; });
    if((tr.advice_ar||[]).length){ const cur=$('#rxAdvice').value.trim(); $('#rxAdvice').value = (cur?cur+'\n':'') + tr.advice_ar.join('، '); }
    toast(`تمت إضافة ${n} دواء — راجعها قبل الطباعة`);
    renderAI(); go('rx');
  } else { renderAI(); toast('تم اعتماد التشخيص'); }
});

// مطابقة دواء الذكاء الاصطناعي بالقاعدة
function normS(s){ return (s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
function findDrug(generic, strength){
  const g = normS(generic); if(!g) return null;
  const cands = allDrugs().filter(d=>{ const dg=normS(d.g); return dg===g || dg.startsWith(g) || g.startsWith(dg) || normS(d.b).split(' ').includes(g.split(' ')[0]); });
  if(!cands.length) return null;
  const s = normS(strength);
  const wantSyr = /syr|susp|ml/.test(s) || (isChild() && !/tab|cap/.test(s));
  const scored = cands.map(d=>{
    const ds = normS(d.s); let sc=0;
    const n1 = (s.match(/\d+/)||[])[0]; if(n1 && ds.includes(n1)) sc+=3;
    if(wantSyr === !!d.ped || wantSyr === /syr|susp/.test(ds)) sc+=2;
    if(normS(d.g)===g) sc+=1;
    return {d,sc};
  }).sort((a,b)=>b.sc-a.sc);
  return scored[0].d;
}
function addFromAI(x){
  const d = findDrug(x.generic, x.strength);
  const item = {uid:uid(), drugId:d?d.id:null, name:d?d.g:x.generic, strength:d?d.s:(x.strength||''), sig:x.sig_ar||'', dur:x.duration_ar||'', calc:'', ai:true};
  if(d && d.ped && isChild() && P.weight){ const pd=window.Rules.pedDose(d,P.weight); if(pd){ item.sig=pd.sig; item.calc=pd.calc; } }
  else if(d && !item.sig) item.sig = d.sig;
  if(!item.dur && d) item.dur = d.dur;
  rx.push(item);
}

// ================= الوصفة =================
function itemFromDrug(d, over){
  readPatient();
  const it = {uid:uid(), drugId:d.id, name:d.g, strength:d.s, sig:d.sig||'', dur:d.dur||'', calc:''};
  if(d.ped){
    if(P.weight){ const pd=window.Rules.pedDose(d,P.weight); it.sig=pd.sig; it.calc=pd.calc; }
    else it.sig = 'أدخل وزن الطفل لحساب الجرعة';
  }
  if(over){ if(over.dur) it.dur=over.dur; if(over.sig) it.sig=over.sig; }
  return it;
}
function addDrug(d, over){ rx.push(itemFromDrug(d, over)); renderRx(); }

function recalcPeds(){
  rx.forEach(it=>{
    const d = it.drugId && drugById(it.drugId);
    if(d && d.ped && P.weight && !it.edited){ const pd=window.Rules.pedDose(d,P.weight); it.sig=pd.sig; it.calc=pd.calc; }
  });
}

function renderRx(){
  readPatient();
  $('#rxEmpty').style.display = rx.length?'none':'';
  $('#rxList').innerHTML = rx.map((it,i)=>`
    <div class="rxi" data-u="${it.uid}">
      <div class="hd"><div class="nm">${i+1}. ${esc(it.name)} <small>${esc(it.strength)}</small></div><button class="x" data-rm="${it.uid}">✕</button></div>
      ${it.calc?`<div class="calc">🧮 ${esc(it.calc)}</div>`:''}
      ${it.ai?`<div class="calc" style="color:var(--blue)">🤖 مقترح من الذكاء الاصطناعي — راجع الجرعة</div>`:''}
      <label class="f">طريقة الاستعمال</label><textarea data-k="sig">${esc(it.sig)}</textarea>
      <div class="row"><div><label class="f">المدة</label><input type="text" data-k="dur" value="${esc(it.dur)}"></div></div>
    </div>`).join('');
  $('#rxBadge').style.display = rx.length?'':'none'; $('#rxBadge').textContent = rx.length;
  refreshWarnings();
}
$('#rxList').addEventListener('input',e=>{
  const box=e.target.closest('.rxi'); const k=e.target.dataset.k; if(!box||!k) return;
  const it=rx.find(x=>x.uid===box.dataset.u); if(it){ it[k]=e.target.value; it.edited=true; }
});
$('#rxList').addEventListener('click',e=>{
  const b=e.target.closest('[data-rm]'); if(!b) return;
  rx = rx.filter(x=>x.uid!==b.dataset.rm); renderRx();
});

function refreshWarnings(){
  readPatient();
  const items = rx.map(it=>({name:it.name, drug: it.drugId? drugById(it.drugId): (findDrug(it.name,it.strength))}));
  const w = window.Rules.check(P, items);
  $('#warnCard').style.display = w.length?'':'none';
  $('#warnList').innerHTML = w.map(x=>`<div class="w ${x.sev}">${esc(x.msg)}</div>`).join('');
  const highs = w.filter(x=>x.sev==='high').length;
  return {w, highs};
}

// البحث عن دواء
function searchDrugs(q){
  q = q.trim().toLowerCase(); if(q.length<2) return [];
  const AR = {'بنادول':'panadol','باراسيتامول':'paracetamol','اموكسيل':'amox','أموكسيل':'amox','اوگمنتين':'augmentin','اوجمنتين':'augmentin','بروفين':'brufen','فولتارين':'voltaren','فلاجيل':'flagyl','زثرومايسين':'zithromax','ازثرومايسين':'azith','اوميبرازول':'omeprazole','بسكوبان':'buscopan','فنتولين':'ventolin','سبترين':'septrin','كلوكوفاج':'glucophage','كونكور':'concor','زيرتك':'zyrtec'};
  Object.entries(AR).forEach(([a,e])=>{ if(q.includes(a)) q=q.replace(a,e); });
  const words = q.split(/\s+/);
  const res = allDrugs().map(d=>{
    const hay = (d.g+' '+(d.b||'')+' '+d.s).toLowerCase();
    if(!words.every(w=>hay.includes(w))) return null;
    let sc = d.g.toLowerCase().startsWith(words[0])?3:(hay.includes(' '+words[0])?1:0);
    if(isChild() && d.ped) sc+=2;
    return {d,sc};
  }).filter(Boolean).sort((a,b)=>b.sc-a.sc).slice(0,25).map(x=>x.d);
  return res;
}
$('#drugSearch').addEventListener('input',e=>{
  const r = searchDrugs(e.target.value); const box=$('#searchRes');
  if(!e.target.value.trim()){ box.classList.remove('on'); return; }
  box.innerHTML = r.length ? r.map(d=>`<div class="sr" data-id="${d.id}"><b class="ltr" style="display:block">${esc(d.g)} — ${esc(d.s)}</b><small class="ltr">${esc(d.b||'')}${d.ped?' · 👶 جرعة حسب الوزن':''}</small></div>`).join('')
    : `<div class="sr" data-custom="1">ما لقيته — اضغط لإضافة "${esc(e.target.value)}" كدواء جديد</div>`;
  box.classList.add('on');
});
$('#searchRes').addEventListener('click',e=>{
  const s=e.target.closest('.sr'); if(!s) return;
  if(s.dataset.custom){ openCustom($('#drugSearch').value); }
  else { addDrug(drugById(s.dataset.id)); toast('تمت الإضافة'); }
  $('#drugSearch').value=''; $('#searchRes').classList.remove('on');
});

// دواء مخصص
function openCustom(name){ $('#cName').value=name||''; $('#cStr').value=''; $('#cSig').value=''; $('#cDur').value=''; openM('#mCustom'); setTimeout(()=>$('#cName').focus(),200); }
$('#btnCustom').addEventListener('click',()=>openCustom(''));
$('#cAdd').addEventListener('click',()=>{
  const name=$('#cName').value.trim(); if(!name){ toast('اكتب اسم الدواء'); return; }
  const d = {id:'c'+Date.now(), g:name, b:'', s:$('#cStr').value.trim(), sig:$('#cSig').value.trim(), dur:$('#cDur').value.trim(), cls:'custom_'+name.toLowerCase(), tags:[], custom:true};
  if($('#cSave').checked){ customDrugs.push(d); LS.set('customDrugs',customDrugs); renderManage(); }
  rx.push({uid:uid(), drugId: $('#cSave').checked? d.id : null, name:d.g, strength:d.s, sig:d.sig, dur:d.dur, calc:''});
  closeM($('#cAdd')); renderRx();
});

// القوالب
function renderTplList(){
  $('#tplList').innerHTML = templates.length ? templates.map((t,i)=>`<div class="sr" data-t="${i}"><span><b>${esc(t.name)}</b><small>${t.items.length} دواء</small></span><span style="flex:none">←</span></div>`).join('') : '<div class="muted">لا توجد قوالب — احفظ وصفة كقالب.</div>';
}
$('#btnTpl').addEventListener('click',()=>{ renderTplList(); openM('#mTpl'); });
$('#tplList').addEventListener('click',e=>{
  const s=e.target.closest('[data-t]'); if(!s) return;
  const t = templates[+s.dataset.t]; readPatient();
  t.items.forEach(x=>{
    const d = drugById(x.id);
    if(d){ const it=itemFromDrug(d,{dur:x.dur}); if(x.sig && !d.ped) it.sig=x.sig; rx.push(it); }
    else if(x.name){ rx.push({uid:uid(),drugId:null,name:x.name,strength:x.strength||'',sig:x.sig||'',dur:x.dur||'',calc:''}); }
  });
  if(t.dx && !$('#rxDx').value) $('#rxDx').value=t.dx;
  if(t.advice){ const c=$('#rxAdvice').value.trim(); $('#rxAdvice').value = c? c+'\n'+t.advice : t.advice; }
  closeM(s); renderRx(); toast('تم تطبيق القالب — راجع الجرعات');
});
$('#btnSaveTpl').addEventListener('click',()=>{
  if(!rx.length){ toast('أضف أدوية أولاً'); return; }
  const name = prompt('اسم القالب:', $('#rxDx').value || 'قالب جديد'); if(!name) return;
  templates.push({name, dx:$('#rxDx').value.trim(), advice:$('#rxAdvice').value.trim(),
    items: rx.map(it=>it.drugId? {id:it.drugId, sig: (drugById(it.drugId)||{}).ped? '' : it.sig, dur:it.dur} : {name:it.name,strength:it.strength,sig:it.sig,dur:it.dur})});
  LS.set('templates',templates); renderManage(); toast('تم حفظ القالب');
});

// ================= فحص الوصفة بالذكاء الاصطناعي =================
$('#btnAiCheck').addEventListener('click', async ()=>{
  if(!rx.length){ toast('أضف أدوية أولاً'); return; }
  readPatient(); const btn=$('#btnAiCheck'); busy(btn,true,'جاري الفحص…');
  try{
    const r = await window.AI.checkRx(P, $('#rxDx').value.trim(), rx.map(it=>`${it.name} ${it.strength} — ${it.sig} — ${it.dur}`));
    const iss = r.issues||[];
    $('#aiCheckOut').innerHTML = `<div class="card warns"><h2>🤖 نتيجة الفحص الذكي</h2>
      ${iss.length? iss.map(x=>`<div class="w ${esc(x.severity)}">${esc(x.message_ar)}</div>`).join('') : '<div class="note">✅ لم تُلاحظ مشاكل واضحة.</div>'}
      ${(r.suggestions_ar||[]).length?`<h3>💡 اقتراحات</h3><ul class="plain">${li(r.suggestions_ar)}</ul>`:''}
      <div class="muted">للمساعدة فقط — القرار للطبيب.</div></div>`;
  }catch(e){ aiErr(e); }
  busy(btn,false);
});

// ================= إنشاء الوصفة PDF =================
function todayStr(){ const d=new Date(); return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`; }
function buildSheet(){
  readPatient(); const s=settings;
  const showDx = $('#rxShowDx').checked && $('#rxDx').value.trim();
  const sexAr = P.sex==='male'?'ذكر':P.sex==='female'?'أنثى':'';
  const adv = $('#rxAdvice').value.trim(), fu=$('#rxFollow').value.trim();
  const footer = [s.addr?`📍 ${esc(s.addr)}`:'', s.phone?`📞 <span class="ltr">${esc(s.phone)}</span>`:'', s.hours?`🕒 ${esc(s.hours)}`:''].filter(Boolean).join(' &nbsp;|&nbsp; ');
  $('#rxSheet').innerHTML = `
    <div class="rh">
      <div class="ar"><div class="dn">${esc(s.nameAr||'اسم الطبيب')}</div><div class="sp">${esc(s.specAr||'')}</div></div>
      ${s.logo?`<img src="${s.logo}">`:'<img src="icons/icon-192.png" style="width:58px;height:58px">'}
      <div class="en"><div class="dn">${esc(s.nameEn||'')}</div><div class="sp">${esc(s.specEn||'')}</div></div>
    </div>
    <div class="pt">
      <span><b>الاسم:</b> ${esc(P.name||'—')}</span>
      ${P.ageAr?`<span><b>العمر:</b> ${esc(P.ageAr)}</span>`:''}
      ${sexAr?`<span><b>الجنس:</b> ${sexAr}</span>`:''}
      ${P.weight?`<span><b>الوزن:</b> ${P.weight} كغم</span>`:''}
      <span><b>التاريخ:</b> <span class="ltr">${todayStr()}</span></span>
    </div>
    ${showDx?`<div class="dxl"><b>Dx:</b> ${esc($('#rxDx').value.trim())}</div>`:''}
    <div class="rsym">℞</div>
    <ol>${rx.map((it,i)=>`<li><div class="dn">${i+1}. ${esc(it.name)} <small>${esc(it.strength)}</small></div>
      <div class="sg">${esc(it.sig)}</div>${it.dur?`<div class="du">المدة: ${esc(it.dur)}</div>`:''}</li>`).join('')}</ol>
    ${adv?`<div class="adv"><b>إرشادات:</b> ${esc(adv)}</div>`:''}
    ${fu?`<div class="fu"><b>المراجعة بعد:</b> ${esc(fu)}</div>`:''}
    <div class="sigbox"><div>${s.sig?`<img src="${s.sig}">`:'<div style="height:40px"></div>'}توقيع الطبيب</div></div>
    ${footer?`<div class="rf">${footer}</div>`:''}`;
}

let lastPdf = null; // {blob, base64, name}
$('#btnPdf').addEventListener('click', async ()=>{
  if(!rx.length){ toast('أضف أدوية للوصفة أولاً'); return; }
  const {highs} = refreshWarnings();
  if(highs && !confirm(`يوجد ${highs} تنبيه خطير بالوصفة. هل تريد المتابعة؟`)) return;
  if(!settings.nameAr) toast('💡 أضف معلوماتك بالإعدادات حتى تظهر بالترويسة');
  const btn=$('#btnPdf'); busy(btn,true,'جاري الإنشاء…');
  try{
    buildSheet();
    await document.fonts.ready;
    const canvas = await html2canvas($('#rxSheet'), {scale:3, backgroundColor:'#ffffff', useCORS:true, logging:false});
    const img = canvas.toDataURL('image/jpeg', 0.92);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({orientation:'p', unit:'mm', format:'a5'});
    const pw=148, ph=210; const ih = canvas.height * pw / canvas.width;
    if(ih <= ph+0.5){ pdf.addImage(img,'JPEG',0,0,pw,ih); }
    else {
      // تقسيم على صفحات
      const pagePx = Math.floor(canvas.width * ph / pw);
      for(let y=0, first=true; y<canvas.height; y+=pagePx, first=false){
        const c=document.createElement('canvas'); c.width=canvas.width; c.height=Math.min(pagePx, canvas.height-y);
        const ctx=c.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,c.width,c.height); ctx.drawImage(canvas,0,-y);
        if(!first) pdf.addPage();
        pdf.addImage(c.toDataURL('image/jpeg',0.92),'JPEG',0,0,pw,c.height*pw/c.width);
      }
    }
    const safe = (P.name||'patient').replace(/[^\p{L}\p{N}]+/gu,'_').slice(0,30);
    const name = `وصفة_${safe}_${todayStr().replace(/\//g,'-')}.pdf`;
    const dataUri = pdf.output('datauristring');
    lastPdf = {name, base64: dataUri.split(',')[1], blob: pdf.output('blob')};
    $('#previewImg').src = img; $('#printArea').innerHTML = `<img src="${img}">`;
    openM('#mPreview');
  }catch(e){ console.error(e); toast('تعذر إنشاء الوصفة: '+(e.message||e)); }
  busy(btn,false);
});

const Cap = window.Capacitor;
const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
async function shareFile(name, base64, blob, mime){
  if(isNative){
    const {Filesystem, Share} = Cap.Plugins;
    const w = await Filesystem.writeFile({path:name, data:base64, directory:'CACHE'});
    await Share.share({title:name, files:[w.uri], dialogTitle:'مشاركة الوصفة'});
    return;
  }
  const file = new File([blob], name, {type:mime});
  if(navigator.canShare && navigator.canShare({files:[file]})){ await navigator.share({files:[file], title:name}); return; }
  download(name, blob);
}
function download(name, blob){
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();},1500);
}
$('#btnShare').addEventListener('click', async ()=>{
  if(!lastPdf) return;
  try{ await shareFile(lastPdf.name, lastPdf.base64, lastPdf.blob, 'application/pdf'); }
  catch(e){ if(!/cancel|abort/i.test(e.message||'')) toast('تعذرت المشاركة'); }
});
$('#btnDownload').addEventListener('click', async ()=>{
  if(!lastPdf) return;
  if(isNative){
    try{ const {Filesystem}=Cap.Plugins; await Filesystem.writeFile({path:lastPdf.name, data:lastPdf.base64, directory:'DOCUMENTS'}); toast('تم الحفظ في مجلد Documents'); }
    catch(e){ toast('احفظها عن طريق زر المشاركة ← الملفات'); }
  } else if(window.matchMedia && /Mobi|Android|iPhone/i.test(navigator.userAgent)) download(lastPdf.name, lastPdf.blob);
  else { download(lastPdf.name, lastPdf.blob); }
});

// ================= مريض جديد =================
function clearPatientUI(){
  ['#pName','#pAgeY','#pAgeM','#pWeight','#pPregW','#pAllergyText','#pChronic','#pMeds','#vTemp','#vBp','#vPulse','#vRr','#vSpo2','#vSugar','#dSymptoms','#dExam','#rxDx','#rxAdvice','#rxFollow','#drugSearch']
    .forEach(id=>{ $(id).value=''; });
  $('#pPreg').checked=false; $('#pBreast').checked=false; $('#pregWeeksBox').style.display='none'; $('#femaleBox').style.display='none';
  $$('#pSex button').forEach(b=>b.classList.remove('on'));
  $('#rxShowDx').checked = !!settings.showDx;
  $('#aiOut').innerHTML=''; $('#aiCheckOut').innerHTML=''; $('#searchRes').classList.remove('on');
  $('#previewImg').src=''; $('#printArea').innerHTML=''; $('#rxSheet').innerHTML='';
  lastPdf=null;
}
function newPatient(){
  resetState(); clearPatientUI(); renderAllergyChips(); renderThumbs(); renderRx(); go('patient');
}
$('#btnNew').addEventListener('click',()=>{
  const has = $('#pName').value || $('#dSymptoms').value || rx.length || files.length;
  if(has && !confirm('مسح كل بيانات المريض الحالي والبدء بمريض جديد؟')) return;
  newPatient(); toast('🧹 تم المسح — مريض جديد');
});
$('#rxShowDx').addEventListener('change',()=>{ settings.showDx=$('#rxShowDx').checked; saveSettings(); });

// ================= الإعدادات =================
const SMAP = {sNameAr:'nameAr',sNameEn:'nameEn',sSpecAr:'specAr',sSpecEn:'specEn',sAddr:'addr',sPhone:'phone',sHours:'hours',sKey:'apiKey'};
function loadSettingsUI(){
  Object.entries(SMAP).forEach(([id,k])=>{ $('#'+id).value = settings[k]||''; });
  $$('#sProvider button').forEach(b=>b.classList.toggle('on', b.dataset.v===settings.provider));
  $('#sModel').value = settings.provider==='claude'? settings.claudeModel : settings.geminiModel;
  $('#keyHelp').innerHTML = settings.provider==='claude'
    ? 'احصل على مفتاح Claude من <a href="https://console.anthropic.com/settings/keys" target="_blank">console.anthropic.com</a> (مدفوع حسب الاستخدام).'
    : 'احصل على مفتاح Gemini مجاناً من <a href="https://aistudio.google.com/apikey" target="_blank">aistudio.google.com/apikey</a> بحساب Google ← Create API key ← انسخه والصقه هنا.';
  ['logo','sig'].forEach(k=>{ const id=k==='logo'?'sLogo':'sSig'; const p=$('#'+id+'Prev'), del=$('#'+id+'Del');
    if(settings[k]){ p.src=settings[k]; p.style.display='block'; del.style.display=''; } else { p.style.display='none'; del.style.display='none'; } });
  $('#rxShowDx').checked = !!settings.showDx;
}
Object.entries(SMAP).forEach(([id,k])=>$('#'+id).addEventListener('input',e=>{ settings[k]=e.target.value.trim(); saveSettings(); }));
$('#sModel').addEventListener('input',e=>{ const v=e.target.value.trim(); if(settings.provider==='claude') settings.claudeModel=v||DEF_SET.claudeModel; else settings.geminiModel=v||DEF_SET.geminiModel; saveSettings(); });
$$('#sProvider button').forEach(b=>b.addEventListener('click',()=>{ settings.provider=b.dataset.v; saveSettings(); loadSettingsUI(); }));
$('#sKeyShow').addEventListener('click',()=>{ const k=$('#sKey'); k.type = k.type==='password'?'text':'password'; });
$('#sTest').addEventListener('click', async ()=>{
  const btn=$('#sTest'); busy(btn,true,'جاري الاختبار…');
  try{ await window.AI.testKey(); toast('✅ الاتصال يعمل'); }catch(e){ aiErr(e); }
  busy(btn,false);
});
async function imgSetting(input, key, max){
  const f=input.files[0]; if(!f) return;
  try{
    const d = await readAsDataURL(f); const img=await loadImg(d);
    const s=Math.min(1,max/Math.max(img.width,img.height)); const c=document.createElement('canvas');
    c.width=Math.round(img.width*s); c.height=Math.round(img.height*s); c.getContext('2d').drawImage(img,0,0,c.width,c.height);
    settings[key]=c.toDataURL('image/png'); saveSettings(); loadSettingsUI(); toast('تم الحفظ');
  }catch(e){ toast('تعذر قراءة الصورة'); }
  input.value='';
}
$('#sLogo').addEventListener('change',e=>imgSetting(e.target,'logo',300));
$('#sSig').addEventListener('change',e=>imgSetting(e.target,'sig',400));
$('#sLogoDel').addEventListener('click',()=>{ settings.logo=''; saveSettings(); loadSettingsUI(); });
$('#sSigDel').addEventListener('click',()=>{ settings.sig=''; saveSettings(); loadSettingsUI(); });

function renderManage(){
  $('#tplManage').innerHTML = templates.length? templates.map((t,i)=>`<div class="sr"><span>${esc(t.name)} <small>${t.items.length} دواء</small></span><button class="x" data-dt="${i}">🗑</button></div>`).join('') : '<div class="muted">لا توجد قوالب.</div>';
  $('#customManage').innerHTML = customDrugs.length? customDrugs.map((d,i)=>`<div class="sr"><span class="ltr">${esc(d.g)} <small>${esc(d.s)}</small></span><button class="x" data-dc="${i}">🗑</button></div>`).join('') : '<div class="muted">لم تضف أدوية بعد.</div>';
}
$('#tplManage').addEventListener('click',e=>{ const b=e.target.closest('[data-dt]'); if(!b) return; if(!confirm('حذف القالب؟')) return; templates.splice(+b.dataset.dt,1); LS.set('templates',templates); renderManage(); });
$('#customManage').addEventListener('click',e=>{ const b=e.target.closest('[data-dc]'); if(!b) return; if(!confirm('حذف الدواء من قائمتك؟')) return; customDrugs.splice(+b.dataset.dc,1); LS.set('customDrugs',customDrugs); renderManage(); });

// نسخة احتياطية
$('#bkExport').addEventListener('click', async ()=>{
  const data = {app:'doctori',v:1,date:new Date().toISOString(),settings:Object.assign({},settings,{apiKey:''}),templates,customDrugs};
  const json = JSON.stringify(data,null,1);
  const blob = new Blob([json],{type:'application/json'});
  const b64 = btoa(unescape(encodeURIComponent(json)));
  try{ await shareFile('doctori-backup.json', b64, blob, 'application/json'); }catch(e){ if(!/cancel|abort/i.test(e.message||'')) download('doctori-backup.json',blob); }
});
$('#bkImport').addEventListener('change', async e=>{
  const f=e.target.files[0]; if(!f) return;
  try{
    const d = JSON.parse(await f.text()); if(d.app!=='doctori') throw 0;
    const key = settings.apiKey;
    settings = Object.assign({},DEF_SET,d.settings||{}); if(!settings.apiKey) settings.apiKey=key;
    templates = d.templates||templates; customDrugs = d.customDrugs||customDrugs;
    saveSettings(); LS.set('templates',templates); LS.set('customDrugs',customDrugs);
    loadSettingsUI(); renderManage(); toast('✅ تم الاستيراد');
  }catch(err){ toast('ملف غير صالح'); }
  e.target.value='';
});

// ================= تشغيل =================
window.App = {settings:()=>settings, saveSettings:()=>{ saveSettings(); loadSettingsUI(); }};
renderAllergyChips(); loadSettingsUI(); renderManage(); renderRx();
setTimeout(()=>{ const s=$('#splash'); s.style.opacity='0'; setTimeout(()=>s.remove(),500);
  if(!LS.get('agreed',false)) openM('#mDisclaimer'); }, 1300);
$('#btnAgree').addEventListener('click',()=>{ LS.set('agreed',true); $('#mDisclaimer').classList.remove('on'); if(!settings.nameAr){ toast('ابدأ بإضافة معلوماتك بالإعدادات'); } });

// زر الرجوع بالأندرويد
if(isNative && Cap.Plugins.App){
  Cap.Plugins.App.addListener('backButton',()=>{
    const m=document.querySelector('.modal.on'); if(m){ m.classList.remove('on'); return; }
    const cur=document.querySelector('section.tab.on').id.replace('tab-','');
    if(cur!=='patient') go('patient'); else Cap.Plugins.App.minimizeApp();
  });
}
if('serviceWorker' in navigator && !isNative && location.protocol==='https:') navigator.serviceWorker.register('sw.js').catch(()=>{});
})();
