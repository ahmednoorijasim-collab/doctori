// فحوصات الأمان: حساسية، حمل، عمر، تداخلات، تكرار
(function(){
const FREQ_AR = {1:'مرة واحدة يومياً',2:'كل 12 ساعة',3:'كل 8 ساعات',4:'كل 6 ساعات'};

// حساب جرعة الأطفال حسب الوزن
function pedDose(drug, weightKg){
  const p = drug.ped; if(!p || !weightKg) return null;
  let mg = p.mgkg * weightKg; let capped = false;
  if(mg > p.max){ mg = p.max; capped = true; }
  let ml = mg * 5 / p.conc;
  ml = Math.round(ml*4)/4; // أقرب ربع مل
  if(ml < 0.25) ml = 0.25;
  const mgR = Math.round(ml * p.conc / 5);
  const freq = p.prn ? (FREQ_AR[p.freq] + ' عند الحاجة') : FREQ_AR[p.freq];
  const sig = `${fmt(ml)} مل ${freq}${p.food?' بعد الأكل':''}`;
  const calc = `${p.mgkg} ملغم/كغم × ${weightKg} كغم ≈ ${mgR} ملغم${p.label?' ('+p.label+')':''} للجرعة${capped?' (تم تحديدها بالجرعة القصوى)':''}`;
  return {ml, mg:mgR, sig, calc, capped};
}
function fmt(n){ return (Math.round(n*100)/100).toString(); }

// قواعد التداخل: [وسم أ، وسم ب، الخطورة، الرسالة]
const PAIR_RULES = [
  ['nsaid','anticoag','high','مسكن NSAID مع الوارفارين: خطر نزف عالي'],
  ['nsaid','antiplatelet','medium','مسكن NSAID مع مضاد صفيحات: يزيد خطر نزف المعدة'],
  ['anticoag','antiplatelet','high','مميّع دم مع مضاد صفيحات: خطر نزف عالي'],
  ['anticoag','cyp3a4inh','high','الوارفارين مع (كلاريثرومايسين/فلوكونازول): يرفع الـ INR بشدة'],
  ['anticoag','metronidazole','high','الوارفارين مع الميترونيدازول: يرفع الـ INR بشدة'],
  ['anticoag','quinolone','high','الوارفارين مع الكوينولون: يرفع الـ INR'],
  ['anticoag','tmpsmx','high','الوارفارين مع السبترين: يرفع الـ INR بشدة'],
  ['raas','ksparing','high','ACEi/ARB مع سبيرونولاكتون: خطر ارتفاع البوتاسيوم'],
  ['raas','potassium','medium','ACEi/ARB مع البوتاسيوم: خطر ارتفاع البوتاسيوم'],
  ['raas','tmpsmx','medium','ACEi/ARB مع السبترين: خطر ارتفاع البوتاسيوم'],
  ['raas','nsaid','medium','ACEi/ARB مع NSAID: يقلل تأثير الضغط وقد يؤذي الكلى'],
  ['statin3a4','cyp3a4inh','high','سيمفاستاتين مع كلاريثرومايسين/فلوكونازول: خطر تحلل العضلات — أوقف الستاتين مؤقتاً'],
  ['statin','cyp3a4inh','medium','ستاتين مع كلاريثرومايسين/فلوكونازول: خطر آلام وتحلل العضلات'],
  ['serotonergic','serotonergic','high','دوائين يرفعان السيروتونين: خطر متلازمة السيروتونين'],
  ['nitrate','pde5','high','النترات مع السيلدينافيل: ممنوع — هبوط ضغط خطير'],
  ['clopidogrel','ppi_clop','medium','كلوبيدوقريل مع أوميبرازول/إيسوميبرازول: يقلل فعاليته — يُفضل بانتوبرازول'],
  ['chelate','antacid','medium','يجب الفصل ساعتين على الأقل بين الدواء ومضادات الحموضة/الكالسيوم/الحديد'],
  ['sulfonylurea','cyp3a4inh','medium','دواء سكر (سلفونيل يوريا) مع فلوكونازول/كلاريثرومايسين: خطر هبوط السكر'],
  ['sulfonylurea','tmpsmx','medium','دواء سكر (سلفونيل يوريا) مع السبترين: خطر هبوط السكر'],
  ['sulfonylurea','quinolone','medium','دواء سكر مع الكوينولون: تذبذب السكر'],
  ['steroid','nsaid','medium','كورتيزون مع NSAID: يزيد خطر قرحة المعدة — فكّر بإضافة PPI'],
  ['sedative','sedative','medium','أكثر من دواء يسبب النعاس: انتبه للتركيز والقيادة'],
  ['qt','qt','medium','أكثر من دواء يطيل فترة QT بالقلب: انتبه خصوصاً لكبار السن ومرضى القلب'],
  ['sympathomimetic','antihtn','medium','مزيل احتقان يرفع الضغط مع مريض يأخذ دواء ضغط'],
  ['metformin','none','low',''],
];

const CROSS_ALLERGY = {penicillin:['cephalosporin']};
const GROUP_NAME = {}; (window.ALLERGY_GROUPS||[]).forEach(g=>GROUP_NAME[g.id]=g.ar);

function norm(s){return (s||'').toString().toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g,' ').trim();}

// إيجاد أدوية المريض الحالية (نص حر) ضمن القاعدة
function matchDrugsInText(text){
  const t = ' '+norm(text)+' ';
  if(t.trim()==='') return [];
  const found = []; const seen = new Set();
  for(const d of window.DRUGS.concat(window.customDrugs?window.customDrugs():[])){
    const names = [d.g].concat((d.b||'').split(',')).map(x=>norm(x).split(' ')[0]).filter(x=>x && x.length>=4);
    for(const n of names){ if(t.includes(' '+n)){ if(!seen.has(d.g)){seen.add(d.g); found.push(d);} break; } }
  }
  return found;
}

// items: [{drug (قد يكون null للدواء المخصص), name}]
function check(patient, items){
  const out = [];
  const ageM = patient.ageMonths;
  const allergies = patient.allergies||[];
  const allergyText = norm(patient.allergyText);
  const current = matchDrugsInText(patient.currentMeds);

  items.forEach(it=>{
    const d = it.drug; const label = it.name;
    if(!d) return;
    // حساسية
    (d.al||[]).forEach(a=>{
      if(allergies.includes(a)) out.push({sev:'high',msg:`⛔ ${label}: المريض عنده حساسية من ${GROUP_NAME[a]||a}`});
    });
    allergies.forEach(a=>{
      (CROSS_ALLERGY[a]||[]).forEach(c=>{ if((d.al||[]).includes(c)) out.push({sev:'medium',msg:`⚠️ ${label}: حساسية البنسلين — احتمال حساسية متصالبة مع السيفالوسبورين (قليلة، بحذر)`}); });
    });
    if(allergyText){
      const words = allergyText.split(' ').filter(w=>w.length>=4);
      const dn = norm(d.g+' '+(d.b||''));
      words.forEach(w=>{ if(dn.includes(w)) out.push({sev:'high',msg:`⛔ ${label}: يطابق حساسية مكتوبة (${w})`}); });
    }
    // حمل
    if(patient.pregnant){
      if(d.preg==='x') out.push({sev:'high',msg:`🤰 ${label}: يُتجنب أثناء الحمل`});
      else if(d.preg==='c') out.push({sev:'medium',msg:`🤰 ${label}: يُستعمل بحذر أثناء الحمل`});
    }
    // عمر
    if(ageM!=null && d.minAge!=null && ageM < d.minAge){
      const yrs = d.minAge>=24 ? `${Math.round(d.minAge/12)} سنة` : `${d.minAge} شهر`;
      const sev = (['aspirin','Aspirin'].includes(d.g) || d.cls==='quinolone' || d.cls==='tetracycline') ? 'high':'medium';
      out.push({sev, msg:`👶 ${label}: الحد الأدنى للعمر ${yrs} (أو الشكل الدوائي غير مناسب لهذا العمر)`});
    }
    if(d.ped && !patient.weight && ageM!=null && ageM<144) out.push({sev:'medium',msg:`⚖️ ${label}: أدخل وزن الطفل لحساب الجرعة`});
  });

  // تكرار نفس الصنف
  const byCls = {};
  items.forEach(it=>{ if(it.drug){ (byCls[it.drug.cls]=byCls[it.drug.cls]||[]).push(it.name);} });
  Object.entries(byCls).forEach(([c,arr])=>{ if(arr.length>1) out.push({sev:'medium',msg:`🔁 تكرار من نفس الصنف: ${arr.join(' + ')}`}); });

  // تداخلات بين الوصفة نفسها، وبين الوصفة وأدوية المريض الحالية
  const pool = items.filter(i=>i.drug).map(i=>({name:i.name,drug:i.drug,src:'rx'}))
    .concat(current.map(d=>({name:d.g+' (دواء حالي)',drug:d,src:'cur'})));
  const seenMsg = new Set();
  for(let i=0;i<pool.length;i++) for(let j=i+1;j<pool.length;j++){
    const A=pool[i], B=pool[j];
    if(A.src==='cur' && B.src==='cur') continue;
    if(A.drug.g===B.drug.g) { if(A.src!==B.src) push('medium',`🔁 ${A.drug.g} موجود أصلاً ضمن أدوية المريض الحالية`); continue; }
    const ta=A.drug.tags||[], tb=B.drug.tags||[];
    for(const [x,y,sev,msg] of PAIR_RULES){
      if(!msg) continue;
      if((ta.includes(x)&&tb.includes(y))||(ta.includes(y)&&tb.includes(x))){
        push(sev, `💊 ${A.name} + ${B.name}: ${msg}`);
      }
    }
  }
  function push(sev,msg){ if(!seenMsg.has(msg)){seenMsg.add(msg); out.push({sev,msg});} }

  // تحذيرات عامة
  if(patient.breastfeeding && items.some(i=>i.drug && (i.drug.preg==='x'))) out.push({sev:'medium',msg:'🍼 المريضة مرضعة — تأكد من أمان الأدوية المعلّمة أثناء الرضاعة'});

  const rank={high:0,medium:1,low:2};
  // إزالة التكرار
  const uniq=[]; const s=new Set(); out.forEach(o=>{ if(!s.has(o.msg)){s.add(o.msg); uniq.push(o);} });
  return uniq.sort((a,b)=>rank[a.sev]-rank[b.sev]);
}

window.Rules = {pedDose, check, matchDrugsInText, FREQ_AR};
})();
