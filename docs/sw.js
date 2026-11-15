// تخزين ملفات التطبيق فقط للعمل بدون إنترنت — لا يخزّن أي بيانات مرضى
const C='doctori-v3';
const FILES=['./','index.html','css/app.css','js/drugs.js','js/rules.js','js/ai.js','js/app.js','lib/html2canvas.min.js','lib/jspdf.umd.min.js',
'fonts/cairo-arabic-400-normal.woff2','fonts/cairo-arabic-700-normal.woff2','fonts/cairo-latin-400-normal.woff2','fonts/cairo-latin-700-normal.woff2','icons/icon-192.png','manifest.webmanifest'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(FILES)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))));self.clients.claim();});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin) return;
  e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r;}).catch(()=>caches.match(e.request)));
});
