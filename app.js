/* global Tesseract */
const DOM = {};
const DOM_IDS = ['home','stage','fileInput','video','canvas','ocrText','transText','confidence','error','histList','sourceLang',
  'btnType','btnFile','btnCam','btnTranslate','btnCopy','btnShare','btnSave','btnBack','btnClearHist','sideCheck'];

let history = JSON.parse(localStorage.getItem('ethioHist')||'[]');

function initUI(){
  DOM_IDS.forEach(id=>DOM[id]=document.getElementById(id));

  const bindClick = (el, handler, name) => {
    if (!el) {
      console.error(`Missing element: ${name}`);
      return;
    }
    el.onclick = handler;
  };
  const bindChange = (el, handler, name) => {
    if (!el) {
      console.error(`Missing element: ${name}`);
      return;
    }
    el.onchange = handler;
  };

  if (DOM.btnFile && DOM.fileInput) {
    DOM.btnFile.addEventListener('click', () => DOM.fileInput.click());
  } else {
    console.error('Upload controls missing: btnFile or fileInput not found.');
  }

  bindClick(DOM.btnType, ()=>{ showStage(); DOM.ocrText?.focus(); }, 'btnType');
  bindChange(DOM.fileInput, e=>handleFile(e.target.files[0]), 'fileInput');
  bindClick(DOM.btnCam, startCamera, 'btnCam');
  bindClick(DOM.btnTranslate, doTranslate, 'btnTranslate');
  bindClick(DOM.btnCopy, ()=>navigator.clipboard.writeText(DOM.transText?.value || ''), 'btnCopy');
  bindClick(DOM.btnShare, ()=>navigator.share({title:'Translation',text:DOM.transText?.value || ''}), 'btnShare');
  bindClick(DOM.btnSave, ()=>saveToHistory(DOM.ocrText?.value || '', DOM.transText?.value || ''), 'btnSave');
  bindClick(DOM.btnBack, ()=>{ if (DOM.stage) DOM.stage.hidden=true; if (DOM.home) DOM.home.hidden=false; if (DOM.error) DOM.error.textContent=''; }, 'btnBack');
  bindClick(DOM.btnClearHist, ()=>{ localStorage.removeItem('ethioHist'); history=[]; renderHistory(); }, 'btnClearHist');
  bindChange(DOM.sideCheck, ()=>DOM.stage?.classList.toggle('sideBySide',DOM.sideCheck.checked), 'sideCheck');

  renderHistory();
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initUI);
} else {
  initUI();
}

const TRANSLATE_ENDPOINTS = [
  {type:'libre', url:"https://libretranslate.de/translate"},
  {type:'libre', url:"https://translate.astian.org/translate"},
  {type:'google', url:"https://translate.googleapis.com/translate_a/single"}
];
const TRANSLATE_TIMEOUT_MS = 10000;
const NORMALIZED_ENDPOINTS = TRANSLATE_ENDPOINTS.map((endpoint) => {
  if (typeof endpoint === 'string') {
    return { type: 'libre', url: endpoint };
  }
  if (!endpoint.type) {
    return { type: 'libre', ...endpoint };
  }
  return endpoint;
});

/* ---- file / camera ---- */
function handleFile(file){
  if(!file) return;
  runOCR(URL.createObjectURL(file));
}
async function startCamera(){
  try{
    const stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
    DOM.video.hidden=false; DOM.video.srcObject=stream; DOM.video.play();
    DOM.video.onclick=()=>{
      const ctx=DOM.canvas.getContext('2d');
      DOM.canvas.width =DOM.video.videoWidth; DOM.canvas.height=DOM.video.videoHeight;
      ctx.drawImage(DOM.video,0,0); stream.getTracks().forEach(t=>t.stop());
      DOM.video.hidden=true;
      runOCR(DOM.canvas.toDataURL());
    };
    alert('Tap video to capture');
  }catch{ showError('Camera access denied'); }
}
/* ---- OCR ---- */
async function runOCR(src){
  showStage(); DOM.ocrText.value='Reading…';
  const worker = await Tesseract.createWorker('amh+tir+eng');
  const {data:{text,confidence}} = await worker.recognize(src);
  await worker.terminate();
  DOM.ocrText.value=text;
  DOM.confidence.querySelector('span').textContent=`${confidenceBand(confidence)} (${Math.round(confidence)}%)`;
  if(confidence<50) DOM.error.textContent='Tip: retake photo in better light, flatten paper, hold steady.';
}
function confidenceBand(c){ if(c>80)return'High'; if(c>55)return'Medium'; return'Low'; }
/* ---- translate ---- */
async function doTranslate(){
  const src = (DOM.ocrText?.value || '').trim();
  if(!src){
    showError('No text to translate. Add text or run OCR first.');
    return;
  }

  DOM.transText.value = 'Translating…';
  DOM.error.textContent = '';

  const sourceLang = (DOM.sourceLang?.value || 'auto');

  const payload = {
    q: src,
    source: sourceLang,
    target: 'en',
    format: 'text'
  };

  let lastError;

  for(const endpoint of NORMALIZED_ENDPOINTS){
    try{
      const translatedText = await requestTranslation(endpoint, payload);
      if(translatedText){
        DOM.transText.value = translatedText;
        return;
      }
      lastError = new Error('Translation unavailable');
    }catch(error){
      lastError = error;
    }
  }

  DOM.transText.value = 'Translation unavailable';
  showError(lastError?.message || 'Translation failed. Please try again.');
}

/* ---- ui helpers ---- */
function showStage(){ DOM.home.hidden=true; DOM.stage.hidden=false; }
function showError(msg){ DOM.error.textContent=msg; }
function saveToHistory(orig,trans){
  history.unshift({orig,trans,date:new Date().toLocaleString()}); history=history.slice(0,20);
  localStorage.setItem('ethioHist',JSON.stringify(history)); renderHistory();
}
function renderHistory(){
  if (!DOM.histList) {
    console.error('Missing element: histList');
    return;
  }
  DOM.histList.innerHTML=history.length
    ?history.map(h=>`<li><strong>${h.orig.slice(0,40)}…</strong><br><em>${h.trans.slice(0,40)}…</em></li>`).join('')
    :'<li>No history yet</li>';
  DOM.histList.onclick=e=>{
    const idx=[...DOM.histList.children].indexOf(e.target.closest('li'));
    if(idx>=0&&idx<history.length){ DOM.ocrText.value=history[idx].orig; DOM.transText.value=history[idx].trans; showStage(); }
  };
}

async function requestTranslation(endpoint, payload){
  const controller = new AbortController();
  const timeoutId = setTimeout(()=>controller.abort(), TRANSLATE_TIMEOUT_MS);
  try{
    if(endpoint.type === 'google'){
      const query = new URLSearchParams({
        client:'gtx',
        sl: payload.source || 'auto',
        tl: payload.target || 'en',
        dt:'t',
        q: payload.q
      });
      const res = await fetch(`${endpoint.url}?${query.toString()}`,{
        method:'GET',
        signal:controller.signal
      });
      const data = await res.json().catch(()=>null);
      if(!res.ok || !Array.isArray(data)){
        throw new Error(`Translation request failed (${res.status})`);
      }
      const translated = data?.[0]?.map(part=>part?.[0]).filter(Boolean).join('') || '';
      return translated;
    }

    const res = await fetch(endpoint.url,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload),
      signal:controller.signal
    });
    const contentType = res.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
      ? await res.json().catch(()=>({}))
      : {};
    const errorText = !contentType.includes('application/json')
      ? await res.text().catch(()=>'')
      : '';
    if(!res.ok){
      throw new Error(data.error || errorText || `Translation request failed (${res.status})`);
    }
    return data.translatedText || data.translation || '';
  }catch(error){
    if(error?.name === 'AbortError'){
      throw new Error('Translation timed out. Please try again.');
    }
    throw error;
  }finally{
    clearTimeout(timeoutId);
  }
}
