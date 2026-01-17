/* global Tesseract */
const DOM = {};
['home','stage','fileInput','video','canvas','ocrText','transText','confidence','error','histList','sourceLang',
 'btnType','btnFile','btnCam','btnTranslate','btnCopy','btnShare','btnSave','btnBack','btnClearHist','sideCheck']
  .forEach(id=>DOM[id]=document.getElementById(id));

let history = JSON.parse(localStorage.getItem('ethioHist')||'[]');
renderHistory();

const TRANSLATE_ENDPOINTS = [
  "https://libretranslate.com/translate"
];
const TRANSLATE_TIMEOUT_MS = 10000;


DOM.btnType.onclick   = ()=>{ showStage(); DOM.ocrText.focus(); };
DOM.btnFile.onclick   = ()=>DOM.fileInput.click();
DOM.fileInput.onchange= e=>handleFile(e.target.files[0]);
DOM.btnCam.onclick    = startCamera;
DOM.btnTranslate.onclick = doTranslate;
DOM.btnCopy.onclick   = ()=>navigator.clipboard.writeText(DOM.transText.value);
DOM.btnShare.onclick  = ()=>navigator.share({title:'Translation',text:DOM.transText.value});
DOM.btnSave.onclick   = ()=>saveToHistory(DOM.ocrText.value, DOM.transText.value);
DOM.btnBack.onclick   = ()=>{ DOM.stage.hidden=true; DOM.home.hidden=false; DOM.error.textContent=''; };
DOM.btnClearHist.onclick= ()=>{ localStorage.removeItem('ethioHist'); history=[]; renderHistory(); };
DOM.sideCheck.onchange= ()=>DOM.stage.classList.toggle('sideBySide',DOM.sideCheck.checked);

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
  const src=DOM.ocrText.value.trim(); if(!src)return;
  DOM.transText.value='Translating…';
  DOM.error.textContent='';
  const sourceLang = DOM.sourceLang?.value || 'auto';
  const payload = {
  q: DOM.srcText.value.trim(),
  source: sourceLang || "auto",
  target: "en",
  format: "text"
};

  let lastError;
  for(const endpoint of TRANSLATE_ENDPOINTS){
    try{
      const translatedText = await requestTranslation(endpoint, payload);
      if(translatedText){
        DOM.transText.value=translatedText;
        return;
      }
      lastError = new Error('Translation unavailable');
    }catch(error){
      lastError = error;
    }
  }
  DOM.transText.value='Translation unavailable';
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
    const res = await fetch(endpoint,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload),
      signal:controller.signal
    });
    const data = await res.json().catch(()=>({}));
    if(!res.ok){
      throw new Error(data.error || `Translation request failed (${res.status})`);
    }
    return data.translatedText || '';
  }catch(error){
    if(error?.name === 'AbortError'){
      throw new Error('Translation timed out. Please try again.');
    }
    throw error;
  }finally{
    clearTimeout(timeoutId);
  }
}



