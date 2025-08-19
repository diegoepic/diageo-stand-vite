// main.ts — lógica del Stand DIAGEO en TypeScript para Vite

import './style.css';

/* ---------------- PWA ---------------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(()=>{}));
}

/* -------------- Helpers UI ----------- */
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const $$ = (sel: string) => Array.from(document.querySelectorAll(sel)) as HTMLElement[];
let idleTimer: number | undefined;

function show(id: string){
  $$('.screen').forEach(s => s.classList.remove('show'));
  $('#'+id)!.classList.add('show');
  resetIdle();
}
function resetIdle(){
  if (idleTimer) window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => hardReset(), 35000);
}
['click','pointerdown','keydown'].forEach(ev => document.addEventListener(ev, resetIdle));
const uid = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;

/* ---- Hora de Chile (America/Santiago) ---- */
const CL_TZ = 'America/Santiago';
function nowChile(date = new Date()){
  const fmt = new Intl.DateTimeFormat('es-CL', {
    timeZone: CL_TZ, year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function toast(msg: string, type?: 'ok' | 'err'){
  const t = $('#toast')!;
  t.textContent = msg; t.className=''; if(type) t.classList.add(type);
  (t as any).style.display='block';
  window.clearTimeout((t as any)._h);
  (t as any)._h = window.setTimeout(()=> (t as any).style.display='none', 1800);
}
function overlay(type: 'ok'|'err', title?: string, sub?: string){
  const o = $('#overlay')!, c = $('#ovCard')!;
  $('#ovTitle')!.textContent = title || ''; $('#ovSub')!.textContent = sub || '';
  c.className = 'ov-card ' + (type==='ok' ? 'ov-ok' : 'ov-err');
  o.classList.add('show');
  window.clearTimeout((o as any)._h);
  (o as any)._h = window.setTimeout(()=> o.classList.remove('show'), 900);
}

/* -------------- Config preguntas ----- */
type BrandKey = 'tanqueray' | 'johnnie_walker';
type QuestionCfg = { id:string; text:string; options:string[]; correctIndex:number; screenOk:string; timeLimitMs:number; };
const QUESTIONS: Record<BrandKey, QuestionCfg> = {
  tanqueray: {
    id:'tq_q01',
    text:'¿Cómo se prepara un Gin Tanqueray & Tonic perfecto?',
    options:[
      '35% gin Tanqueray · 65% agua tónica premium · limón',
      '30% gin Tanqueray · 70% agua tónica premium · limón', // correcta
      '25% gin Tanqueray · 75% agua tónica premium · limón'
    ],
    correctIndex:1,
    screenOk:'scrTQOk',
    timeLimitMs:15000
  },
  johnnie_walker: {
    id:'jw_q01',
    text:'¿Cuál de estos NO es una variante de Johnnie Walker?',
    options:['Johnnie Walker Black','Johnnie Walker Honey','Johnnie Walker Gold','Johnnie Walker Blonde'],
    correctIndex:1,
    screenOk:'scrJWOk',
    timeLimitMs:15000
  }
};

/* -------------- IndexedDB ------------- */
let db: IDBDatabase | null = null;
(function openDB(){
  const req = indexedDB.open('diageo-game', 1);
  req.onupgradeneeded = e => {
    db = (e.target as IDBOpenDBRequest).result;
    db.createObjectStore('participants', { keyPath:'participant_id' });
    db.createObjectStore('rounds', { keyPath:'round_id' });
    db.createObjectStore('entries', { keyPath:'entry_id' });
    db.createObjectStore('events', { keyPath:'event_id' });
  };
  req.onsuccess = e => { db = (e.target as IDBOpenDBRequest).result; };
})();
function put(store: string, obj: any){ return new Promise<void>((res,rej)=>{
  if(!db) return rej('DB not ready'); const tx = db.transaction(store,'readwrite'); tx.objectStore(store).put(obj);
  tx.oncomplete = () => res(); tx.onerror = () => rej((tx as any).error);
});}
function all(store: string){ return new Promise<any[]>((res,rej)=>{
  if(!db) return rej('DB not ready'); const tx = db.transaction(store,'readonly'); const r: any[] = [];
  tx.objectStore(store).openCursor().onsuccess = e => { const c = (e.target as any).result as IDBCursorWithValue | null; if(c){ r.push(c.value); c.continue(); } else res(r); };
  tx.onerror = () => rej((tx as any).error);
});}

/* -------------- Respaldo (File System API) */
let dirHandle: any = null;
async function pickDir(){
  try{ // @ts-ignore
    dirHandle = await (window as any).showDirectoryPicker(); $('#dirInfo')!.textContent='Carpeta seleccionada para respaldo.'; }catch{}
}
async function appendNDJSON(filename: string, obj: any){
  if(!dirHandle) return;
  const fileHandle = await dirHandle.getFileHandle(filename,{create:true});
  const writable = await fileHandle.createWritable({keepExistingData:true});
  await writable.write(JSON.stringify(obj)+'\n'); await writable.close();
}

/* -------------- Eventos (log) ---------- */
async function logEvent(type: string, data: any = {}){
  try{
    const now = new Date();
    const evt = {
      event_id: uid('evt'),
      ts: now.toISOString(),   // UTC
      ts_cl: nowChile(now),    // Chile
      tz: CL_TZ,
      type,
      ...data
    };
    await put('events', evt); await appendNDJSON('events.ndjson', evt); return evt;
  }catch(e){ toast('No se pudo guardar el evento', 'err'); console.error(e); }
}

/* -------------- CSV en español ---------- */
const SEP = ';';
function boolES(v: any){ return v === true ? 'Sí' : v === false ? 'No' : ''; }

type Col = { key: string; header: string; transform?: (val: any, row: any) => any };
function toCSVLocalized(rows: any[], columns: Col[], sep: string = SEP){
  const esc = (v: any) => `"`+String(v ?? '').replaceAll('"','""')+`"`;
  const headers = columns.map(c => c.header).join(sep);
  if (!rows || rows.length === 0) return headers + '\r\n';
  const lines = rows.map(row => columns.map(c => {
    let val = row[c.key];
    if (typeof c.transform === 'function') val = c.transform(val, row);
    return esc(val);
  }).join(sep));
  return headers + '\r\n' + lines.join('\r\n');
}
function downloadCSV(name: string, text: string){
  const blob = new Blob(["\ufeff" + text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

const PARTICIPANT_COLUMNS: Col[] = [
  { key:'participant_id', header:'ID PARTICIPANTE' },
  { key:'name',          header:'NOMBRE' },
  { key:'email',         header:'CORREO' },
  { key:'phone',         header:'TELÉFONO' },
  { key:'is_18plus',     header:'MAYOR DE 18', transform: boolES },
  { key:'created_at',    header:'FECHA DE REGISTRO (UTC ISO)' },
  { key:'created_at_cl', header:'FECHA DE REGISTRO ' },
  { key:'device_id',     header:'ID DISPOSITIVO' },
];
const ROUNDS_COLUMNS: Col[] = [
  { key:'round_id',          header:'ID RONDA' },
  { key:'participant_id',    header:'ID PARTICIPANTE' },
  { key:'started_at',        header:'INICIO (UTC ISO)' },
  { key:'started_at_cl',     header:'INICIO' },
  { key:'finished_at',       header:'FIN (UTC ISO)' },
  { key:'finished_at_cl',    header:'FIN ' },
  { key:'tanq_shown',        header:'TANQUERAY MOSTRADA',        transform: boolES },
  { key:'tanq_answered',     header:'TANQUERAY RESPONDIDA',      transform: boolES },
  { key:'tanq_question_id',  header:'TANQUERAY ID PREGUNTA' },
  { key:'tanq_answer',       header:'TANQUERAY RESPUESTA' },
  { key:'tanq_correct',      header:'TANQUERAY CORRECTA',        transform: v => v==null ? '' : boolES(v) },
  { key:'tanq_time_ms',      header:'TANQUERAY TIEMPO (ms)' },
  { key:'jw_shown',          header:'JOHNNIE WALKER MOSTRADA',   transform: boolES },
  { key:'jw_answered',       header:'JOHNNIE WALKER RESPONDIDA', transform: boolES },
  { key:'jw_question_id',    header:'JW ID PREGUNTA' },
  { key:'jw_answer',         header:'JW RESPUESTA' },
  { key:'jw_correct',        header:'JW CORRECTA',               transform: v => v==null ? '' : boolES(v) },
  { key:'jw_time_ms',        header:'JW TIEMPO (ms)' },
  { key:'entered_brands',    header:'MARCAS EN LAS QUE ENTRA',   transform: v => Array.isArray(v) ? v.join(' | ') : '' },
];
const ENTRIES_COLUMNS: Col[] = [
  { key:'entry_id',      header:'ID INSCRIPCIÓN' },
  { key:'round_id',      header:'ID RONDA' },
  { key:'participant_id',header:'ID PARTICIPANTE' },
  { key:'brand',         header:'MARCA' },
  { key:'qualified',     header:'CLASIFICA',           transform: boolES },
  { key:'reason',        header:'MOTIVO' },
  { key:'answer',        header:'RESPUESTA' },
  { key:'correct',       header:'RESPUESTA CORRECTA',  transform: v => v==null ? '' : boolES(v) },
  { key:'responded_at',    header:'FECHA RESPUESTA (UTC ISO)' },
  { key:'responded_at_cl', header:'FECHA RESPUESTA' },
];

/* -------------- Estado ------------------ */
let device_id = localStorage.getItem('device_id') || (localStorage.setItem('device_id', uid('dev')), localStorage.getItem('device_id'))!;
let participant: any = null, round: any = null;
let entries: Record<BrandKey, boolean> = { tanqueray:false, johnnie_walker:false };

/* -------------- Flujo ------------------- */
$('#btnStart')!.onclick = ()=> show('scrForm');
$('#btnFormBack')!.onclick = ()=> show('scrHome');

$('#btnFormNext')!.onclick = async ()=>{
  const name = ($('#fName') as HTMLInputElement).value.trim();
  const age  = parseInt(($('#fAge') as HTMLInputElement).value || '0', 10);
  if(!name || !($('#f18') as HTMLInputElement).checked || isNaN(age) || age<18){ toast('Completa nombre y confirma ser +18', 'err'); return; }
  const now = new Date();
  participant = {
    participant_id: uid('p'),
    name,
    email: ($('#fEmail') as HTMLInputElement).value.trim(),
    phone: ($('#fPhone') as HTMLInputElement).value.trim(),
    is_18plus: true,
    created_at: now.toISOString(),   // UTC
    created_at_cl: nowChile(now),    // Chile
    device_id
  };
  await put('participants', participant);
  await logEvent('participant_registered', {participant_id: participant.participant_id, name: participant.name});

  const nowStart = new Date();
  round = {
    round_id: uid('r'),
    participant_id: participant.participant_id,
    started_at: nowStart.toISOString(),   // UTC
    started_at_cl: nowChile(nowStart),    // Chile
    finished_at: null,
    finished_at_cl: null,
    tanq_shown:false, tanq_answered:false, tanq_question_id:null, tanq_answer:null, tanq_correct:null, tanq_time_ms:null,
    jw_shown:false,   jw_answered:false,   jw_question_id:null,   jw_answer:null,   jw_correct:null,   jw_time_ms:null,
    entered_brands:[] as string[]
  };
  await put('rounds', round);
  await logEvent('round_started', {round_id: round.round_id, participant_id: round.participant_id});

  startQuestion('tanqueray');
};

/* -------------- Timer ------------------- */
function startTimer(ms: number, el: HTMLElement, onTick?: (dt:number)=>void, onEnd?: (ms:number)=>void){
  const start = performance.now(); el.style.width='100%'; let af = 0;
  function frame(t: number){ const dt=t-start; const left=Math.max(0,1-(dt/ms)); el.style.width=(left*100)+'%'; onTick?.(dt); if(dt>=ms){ cancelAnimationFrame(af); onEnd?.(ms); } else { af=requestAnimationFrame(frame); } }
  af=requestAnimationFrame(frame); return ()=>cancelAnimationFrame(af);
}

/* -------------- Render Preguntas -------- */
function renderQuestion(brand: BrandKey){
  const cfg = QUESTIONS[brand];
  const wrap = (brand==='tanqueray') ? $('#tqOpts')! : $('#jwOpts')!;
  wrap.innerHTML='';
  cfg.options.forEach((txt,idx)=>{
    const b=document.createElement('button');
    b.className='opt ' + (brand==='tanqueray' ? 'tq' : 'jw');
    b.innerHTML = `<span class="letter">${String.fromCharCode(65+idx)}</span> <span>${txt}</span>`;
    b.onclick = ()=> submitAnswer(brand, idx, txt, b);
    wrap.appendChild(b);
  });
  (brand==='tanqueray' ? $('#tqQ')! : $('#jwQ')!).textContent = cfg.text;
}

let cancelTimerFn: (()=>void) | null = null;
async function startQuestion(brand: BrandKey){
  renderQuestion(brand);
  const cfg = QUESTIONS[brand];
  if(brand==='tanqueray'){ show('scrTQ'); round.tanq_shown=true; round.tanq_question_id=cfg.id; }
  else { show('scrJW'); round.jw_shown=true; round.jw_question_id=cfg.id; }
  await put('rounds', round);
  await logEvent('question_shown', {round_id: round.round_id, brand, question_id: cfg.id});
  const bar = (brand==='tanqueray') ? $('#tqTimer')! : $('#jwTimer')!;
  let elapsed=0;
  cancelTimerFn = startTimer(cfg.timeLimitMs, bar, dt=>{ elapsed=dt|0; }, ()=> submitAnswer(brand, null as any, null as any, null as any, elapsed));
}

function disableOptions(containerSel: string){ $$(containerSel+' .opt').forEach(o=> (o as HTMLButtonElement).disabled=true); }

async function submitAnswer(brand: BrandKey, idx: number | null, txt: string | null, btn: HTMLButtonElement | null, elapsedMs?: number){
  if(cancelTimerFn){ cancelTimerFn(); cancelTimerFn=null; }
  const cfg = QUESTIONS[brand];
  const is_correct = (idx===cfg.correctIndex);
  const response_ms = typeof elapsedMs==='number' ? elapsedMs : Math.min(99999, cfg.timeLimitMs);

  // Lock UI
  if(brand==='tanqueray') disableOptions('#tqOpts'); else disableOptions('#jwOpts');

  await logEvent('answer_submitted', {
    round_id: round.round_id, brand, question_id: cfg.id,
    answer_index: idx, answer_text: txt, is_correct, response_ms
  });

  // Persist en round
  if(brand==='tanqueray'){
    round.tanq_answered = idx!==null; round.tanq_answer = txt; round.tanq_correct = idx!==null ? is_correct : null; round.tanq_time_ms = response_ms;
  }else{
    round.jw_answered = idx!==null; round.jw_answer = txt; round.jw_correct = idx!==null ? is_correct : null; round.jw_time_ms = response_ms;
  }
  await put('rounds', round);

  // Feedback + regla: entra SOLO si acierta
  if(idx===null){
    toast('Se acabó el tiempo', 'err');
  } else if(is_correct){
    if(btn) btn.classList.add('pulse-ok');
    await createEntry(brand, true, txt || '');
    overlay('ok','¡Correcto!','Estás participando');
    show(cfg.screenOk); // pantalla de marca breve
  } else {
    if(btn) btn.classList.add('shake');
    toast('Respuesta incorrecta', 'err');
    overlay('err','Respuesta incorrecta','Sigue participando');
  }

  window.setTimeout(()=>{
    if(brand==='tanqueray'){ startQuestion('johnnie_walker'); }
    else { finishRound(); }
  }, 1200);
}

async function createEntry(brand: BrandKey, is_correct: boolean, answer: string){
  const nowAns = new Date();
  const entry = {
    entry_id:uid('e'),
    round_id:round.round_id,
    participant_id:participant.participant_id,
    brand,
    qualified:is_correct,
    reason:is_correct?'correct':'',
    answer,
    correct:is_correct,
    responded_at: nowAns.toISOString(),  // UTC
    responded_at_cl: nowChile(nowAns)    // Chile
  };
  try{
    await put('entries', entry); await logEvent('entry_created', entry);
    entries[brand] = !!is_correct;
    round.entered_brands = Object.entries(entries).filter(([_,v])=>v).map(([k])=>k);
  }catch(e){ toast('No se pudo guardar la inscripción', 'err'); console.error(e); }
}

async function finishRound(){
  const nowEnd = new Date();
  round.finished_at = nowEnd.toISOString();      // UTC
  round.finished_at_cl = nowChile(nowEnd);       // Chile
  await put('rounds', round);
  await logEvent('round_finished', {round_id: round.round_id, entered_brands: round.entered_brands});

  // Badges en final (solo marcas correctas)
  $('#badgeTQ')!.classList.toggle('hidden', !entries.tanqueray);
  $('#badgeJW')!.classList.toggle('hidden', !entries.johnnie_walker);
  show('scrEnd');

  // Auto retorno a portada tras 7s
  window.setTimeout(()=> hardReset(), 7000);
}

function hardReset(){
  participant=null; round=null; entries={tanqueray:false, johnnie_walker:false};
  show('scrHome');
}

/* ---------- Panel admin (tap 5×) -------- */
let taps=0, tapTimer: number | null = null;
$('#staffTap')!.addEventListener('click', ()=>{
  taps++; if (tapTimer) window.clearTimeout(tapTimer);
  tapTimer = window.setTimeout(()=>{taps=0}, 800) as unknown as number;
  if(taps>=5){ taps=0; ($('#staffPanel') as HTMLElement).style.display='flex'; }
});
$('#btnCloseStaff')!.onclick = ()=> ($('#staffPanel') as HTMLElement).style.display='none';
$('#btnHardReset')!.onclick = ()=> { ($('#staffPanel') as HTMLElement).style.display='none'; hardReset(); };
$('#btnPickDir')!.onclick = pickDir;

// Exportaciones
$('#btnExportParticipants')!.onclick = async ()=>{
  const rows = await all('participants');
  downloadCSV('participants.csv', toCSVLocalized(rows, PARTICIPANT_COLUMNS));
};
$('#btnExportRounds')!.onclick = async ()=>{
  const rows = await all('rounds');
  downloadCSV('rounds.csv', toCSVLocalized(rows, ROUNDS_COLUMNS));
};
$('#btnExportEntries')!.onclick = async ()=>{
  const rows = await all('entries');
  downloadCSV('entries.csv', toCSVLocalized(rows, ENTRIES_COLUMNS));
};
$('#btnExportEvents')!.onclick = async ()=>{
  const rows = await all('events');
  const text = rows.map(r=>JSON.stringify(r)).join('\n');
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='events.jsonl'; a.click();
  URL.revokeObjectURL(url);
};
