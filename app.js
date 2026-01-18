/* global Tesseract */
const DOM = {};
[
  'home','stage','fileInput','video','canvas','ocrText','transText','confidence','error','histList','sourceLang',
  'btnType','btnFile','btnCam','btnTranslate','btnCopy','btnShare','btnSave','btnBack','btnClearHist','sideCheck'
].forEach(id => DOM[id] = document.getElementById(id));

let history = JSON.parse(localStorage.getItem('ethioHist') || '[]');
renderHistory();

/** Translation endpoints (server-side is best; these are best-effort public endpoints) */
const TRANSLATE_ENDPOINTS = [
  { type: 'libre',  url: 'https://libretranslate.de/translate' },
  { type: 'libre',  url: 'https://translate.astian.org/translate' },
  { type: 'google', url: 'https://translate.googleapis.com/translate_a/single' }
];
const TRANSLATE_TIMEOUT_MS = 10000;

/* ---- wire up buttons safely ---- */
if (DOM.btnType)      DOM.btnType.onclick = () => { showStage(); DOM.ocrText?.focus(); };
if (DOM.btnFile)      DOM.btnFile.onclick = () => DOM.fileInput?.click();
if (DOM.fileInput)    DOM.fileInput.onchange = e => handleFile(e.target.files?.[0]);
if (DOM.btnCam)       DOM.btnCam.onclick = startCamera;
if (DOM.btnTranslate) DOM.btnTranslate.onclick = doTranslate;

if (DOM.btnCopy)  DOM.btnCopy.onclick  = () => navigator.clipboard.writeText(DOM.transText?.value || '');
if (DOM.btnShare) DOM.btnShare.onclick = () => navigator.share({ title:'Translation', text: DOM.transText?.value || '' });

if (DOM.btnSave) DOM.btnSave.onclick = () => saveToHistory(DOM.ocrText?.value || '', DOM.transText?.value || '');

if (DOM.btnBack) {
  DOM.btnBack.onclick = () => {
    if (DOM.stage) DOM.stage.hidden = true;
    if (DOM.home)  DOM.home.hidden  = false;
    if (DOM.error) DOM.error.textContent = '';
  };
}

if (DOM.btnClearHist) {
  DOM.btnClearHist.onclick = () => {
    localStorage.removeItem('ethioHist');
    history = [];
    renderHistory();
  };
}

if (DOM.sideCheck && DOM.stage) {
  DOM.sideCheck.onchange = () => DOM.stage.classList.toggle('sideBySide', DOM.sideCheck.checked);
}

/* ---- file / camera ---- */
function handleFile(file){
  if(!file) return;
  runOCR(URL.createObjectURL(file));
}

async function startCamera(){
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode:'environment' } });
    DOM.video.hidden = false;
    DOM.video.srcObject = stream;
    await DOM.video.play();

    DOM.video.onclick = () => {
      const ctx = DOM.canvas.getContext('2d');
      DOM.canvas.width  = DOM.video.videoWidth;
      DOM.canvas.height = DOM.video.videoHeight;
      ctx.drawImage(DOM.video, 0, 0);

      stream.getTracks().forEach(t => t.stop());
      DOM.video.hidden = true;

      runOCR(DOM.canvas.toDataURL('image/png'));
    };

    alert('Tap video to capture');
  }catch{
    showError('Camera access denied');
  }
}

/* ---- OCR ---- */
async function runOCR(src){
  showStage();
  DOM.ocrText.value = 'Reading…';

  const worker = await Tesseract.createWorker('amh+tir+eng');
  const { data:{ text, confidence } } = await worker.recognize(src);
  await worker.terminate();

  DOM.ocrText.value = text || '';
  const band = confidenceBand(confidence);
  const pct  = Math.round(confidence || 0);

  const span = DOM.confidence?.querySelector('span');
  if (span) span.textContent = `${band} (${pct}%)`;

  if ((confidence || 0) < 50) {
    DOM.error.textContent = 'Tip: retake photo in better light, flatten paper, hold steady.';
  }
}

function confidenceBand(c){
  if(c > 80) return 'High';
  if(c > 55) return 'Medium';
  return 'Low';
}

/* ---- translate ---- */
async function doTranslate(){
  const src = (DOM.ocrText?.value || '').trim();
  if(!src){
    showError('No text to translate. Add text or run OCR first.');
    return;
  }

  DOM.transText.value = 'Translating…';
  DOM.error.textContent = '';

  const payload = {
    q: src,
    source: DOM.sourceLang?.value || 'auto',
    target: 'en',
    format: 'text'
  };

  let lastError;

  for (const endpoint of TRANSLATE_ENDPOINTS){
    try{
      const translatedText = await requestTranslation(endpoint, payload);
      if (translatedText && translatedText.trim()){
        DOM.transText.value = translatedText;
        return;
      }
      lastError = new Error('Translation unavailable');
    }catch(err){
      lastError = err;
    }
  }

  DOM.transText.value = 'Translation unavailable';
  showError(lastError?.message || 'Translation failed. Please try again.');
}

/* ---- ui helpers ---- */
function showStage(){
  if (DOM.home)  DOM.home.hidden  = true;
  if (DOM.stage) DOM.stage.hidden = false;
}

function showError(msg){
  if (DOM.error) DOM.error.textContent = msg || '';
}

function saveToHistory(orig, trans){
  history.unshift({ orig, trans, date: new Date().toLocaleString() });
  history = history.slice(0, 20);
  localStorage.setItem('ethioHist', JSON.stringify(history));
  renderHistory();
}

function renderHistory(){
  if (!DOM.histList) return;

  DOM.histList.innerHTML = history.length
    ? history.map(h => `<li><strong>${escapeHtml(h.orig.slice(0,40))}…</strong><br><em>${escapeHtml(h.trans.slice(0,40))}…</em></li>`).join('')
    : '<li>No history yet</li>';

  DOM.histList.onclick = e => {
    const li = e.target.closest('li');
    if (!li) return;
    const idx = [...DOM.histList.children].indexOf(li);
    if (idx >= 0 && idx < history.length){
      DOM.ocrText.value  = history[idx].orig;
      DOM.transText.value= history[idx].trans;
      showStage();
    }
  };
}

function escapeHtml(str){
  return (str || '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#039;");
}

/* ---- translation request ---- */
async function requestTranslation(endpoint, payload){
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TRANSLATE_TIMEOUT_MS);

  try{
    // Google translate (unofficial endpoint; can be rate-limited)
    if (endpoint.type === 'google'){
      const query = new URLSearchParams({
        client: 'gtx',
        sl: payload.source || 'auto',
        tl: payload.target || 'en',
        dt: 't',
        q: payload.q
      });

      const res = await fetch(`${endpoint.url}?${query.toString()}`, {
        method: 'GET',
        signal: controller.signal
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(data)){
        throw new Error(`Translation request failed (${res.status})`);
      }

      const translated = (data?.[0] || [])
        .map(part => part?.[0])
        .filter(Boolean)
        .join('') || '';

      return translated;
    }

    // Libre endpoints (POST JSON)
    const res = await fetch(endpoint.url, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const contentType = res.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
      ? await res.json().catch(() => ({}))
      : {};

    if (!res.ok){
      const errMsg = data?.error || `Translation request failed (${res.status})`;
      throw new Error(errMsg);
    }

    return data.translatedText || data.translation || '';
  }catch(err){
    if (err?.name === 'AbortError'){
      throw new Error('Translation timed out. Please try again.');
    }
    throw err;
  }finally{
    clearTimeout(timeoutId);
  }
}
