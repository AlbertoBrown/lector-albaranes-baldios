import {extractFields,clean,parseLiters,parseDeliveryDate,parseDeliveryTime,formatDeliveryDate,csvText} from './extractor.mjs';

const $=id=>document.getElementById(id);
const state={file:null,pdf:null,image:null,page:1,pages:1,rotation:0,zoom:1,results:new Map(),result:null,busy:false,job:0,worker:null,loadingTask:null,renderTask:null,width:0,height:0};
let pdfLibrary,scriptPromise,toastTimer;
const canceled=()=>new DOMException('Operación cancelada','AbortError');
const alive=job=>{if(job!==state.job)throw canceled();};
const numberES=n=>new Intl.NumberFormat('es-ES',{maximumFractionDigits:3,useGrouping:false}).format(n);

function status(message,type='') {$('status').textContent=message;$('status').className='status '+type;}
function badge(message,type='') {$('result-badge').textContent=message;$('result-badge').className='badge '+type;}
function toast(message) {clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,3300);}
function progress(message,value) {$('processing-label').textContent=message;$('progress').value=Math.min(100,Math.max(0,value));}
function setBusy(value) {
  state.busy=value;$('processing').hidden=!value;
  for(const id of ['reading-mode','change-file','file-input','client','liters','delivery-date','delivery-time','reviewed']) $(id).disabled=value;
  $('dropzone').setAttribute('aria-disabled',String(value));
  controls();validity();
}
function controls() {
  $('prev-page').disabled=state.busy||state.page<=1;
  $('next-page').disabled=state.busy||state.page>=state.pages;
  $('rotate').disabled=state.busy||!state.file;
  $('zoom-in').disabled=!state.file||state.zoom>=2.5;
  $('zoom-out').disabled=!state.file||state.zoom<=.75;
  $('page-number').textContent=`Página ${state.page} de ${state.pages}`;
}
function validity(show=false) {
  const client=clean($('client').value),liters=parseLiters($('liters').value);
  const deliveryDate=parseDeliveryDate($('delivery-date').value),deliveryTime=parseDeliveryTime($('delivery-time').value);
  const ok=client.length>=3 && liters!==null && deliveryDate!==null && deliveryTime!==null;
  const enabled=ok&&$('reviewed').checked&&!state.busy;
  $('download').disabled=!enabled;$('copy').disabled=!enabled;
  if(show&&!ok){$('validation').textContent=client.length<3?'Escribe el nombre del cliente.':liters===null?'Introduce una cantidad de litros válida. Ejemplos: 500, 1.250 o 1.250,50.':deliveryDate===null?'Introduce una fecha de entrega válida.':'Introduce una hora de entrega válida.';$('validation').hidden=false;}
  else $('validation').hidden=true;
  return {ok:enabled,client,liters,deliveryDate,deliveryTime};
}
function remember() {
  if(!state.file)return;
  state.results.set(state.page,{result:state.result,client:$('client').value,liters:$('liters').value,deliveryDate:$('delivery-date').value,deliveryTime:$('delivery-time').value,reviewed:$('reviewed').checked});
}
function resetFields() {
  state.result=null;$('client').value='';$('liters').value='';$('delivery-date').value='';$('delivery-time').value='';$('reviewed').checked=false;
  $('client-source').textContent='Se toma el destinatario, no la persona que firma.';
  $('liters-source').textContent='Cantidad del producto en litros, sin duplicados.';
  $('delivery-source').textContent='Se toma la fecha y la hora del apartado (6g).';
  $('highlights').replaceChildren();$('raw-text').textContent='';$('text-details').hidden=true;validity();
}
function showResult(result,saved) {
  state.result=result;
  $('client').value=saved?.client??result?.client??'';
  $('liters').value=saved?.liters??(result?.liters!==null&&result?.liters!==undefined?numberES(result.liters):'');
  $('delivery-date').value=saved?.deliveryDate??result?.deliveryDate??'';
  $('delivery-time').value=saved?.deliveryTime??result?.deliveryTime??'';
  $('reviewed').checked=saved?.reviewed??false;
  $('client-source').textContent=result?.clientSource||'Completa el nombre tal como figura en el documento.';
  $('liters-source').textContent=result?.litersSource||'Comprueba la cantidad y que la unidad sea litros.';
  $('delivery-source').textContent=result?.deliverySource||'Completa la fecha y la hora que figuran en la entrega.';
  $('raw-text').textContent=result?.text||'';$('text-details').hidden=!result?.text;
  if(!result) {status('Consulta el documento y completa el cliente, los litros, la fecha y la hora de entrega.','');badge('Manual');}
  else if(result.warnings.length) {status(result.warnings.join(' '),'warning');badge('Revisar','warning');}
  else {status('Cliente, litros, fecha y hora localizados. Revisa los datos antes de copiarlos o descargarlos.','success');badge(result.source==='pdf'?'PDF · sin IA':'OCR local','ready');}
  drawHighlights();validity();
}
function drawHighlights() {
  $('highlights').replaceChildren();
  if(!state.result||state.rotation!==0)return;
  for(const [field,b] of [['client',state.result.clientBox],['liters',state.result.litersBox],['delivery',state.result.deliveryDateBox],['delivery',state.result.deliveryTimeBox]]) {
    if(!b)continue;
    const d=document.createElement('div');d.className='highlight '+field;
    const w=state.result.width||state.width,h=state.result.height||state.height;
    d.style.left=`${Math.max(0,b.x/w*100)}%`;d.style.top=`${Math.max(0,b.y/h*100)}%`;
    d.style.width=`${Math.min(100,b.width/w*100)}%`;d.style.height=`${Math.min(100,b.height/h*100)}%`;
    $('highlights').append(d);
  }
}
async function getPdfLibrary() {
  if(!pdfLibrary) {
    pdfLibrary=await import('./vendor/pdf.mjs');
    pdfLibrary.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.mjs',import.meta.url).href;
  }
  return pdfLibrary;
}
async function createOcr(job) {
  if(state.worker)return state.worker;
  if(!scriptPromise)scriptPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src='./vendor/tesseract.min.js';
    script.onload=resolve;script.onerror=()=>{scriptPromise=null;script.remove();reject(new Error('No se ha podido cargar el lector OCR. Prueba de nuevo o utiliza el modo manual.'));};document.head.append(script);
  });
  await scriptPromise;alive(job);
  const base=new URL('./vendor/',import.meta.url);
  progress('Preparando el OCR local…',5);
  const worker=await window.Tesseract.createWorker('spa',1,{
    workerPath:new URL('worker.min.js',base).href,
    corePath:new URL('core/',base).href,
    langPath:new URL('lang/',base).href,
    gzip:false,workerBlobURL:false,
    logger:m=>{if(state.busy&&m.status==='recognizing text')progress('Leyendo la imagen en tu dispositivo…',Math.round(15+m.progress*80));},
    errorHandler:()=>{}
  });
  if(job!==state.job){await worker.terminate();throw canceled();}
  state.worker=worker;
  await worker.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1',user_defined_dpi:'240'});
  return worker;
}
async function ocrCanvas(canvas,job) {
  const worker=await createOcr(job);alive(job);
  progress('Leyendo la imagen en tu dispositivo…',16);
  const {data}=await worker.recognize(canvas,{}, {text:true,blocks:true});alive(job);
  const tokens=[];
  for(const b of data.blocks||[])for(const p of b.paragraphs||[])for(const l of p.lines||[])for(const w of l.words||[]) {
    tokens.push({text:w.text,x:w.bbox.x0,y:w.bbox.y1,width:w.bbox.x1-w.bbox.x0,height:w.bbox.y1-w.bbox.y0});
  }
  const result=extractFields(tokens,{width:canvas.width,height:canvas.height,source:'ocr'});
  result.width=canvas.width;result.height=canvas.height;
  if(!result.text)result.text=data.text||'';
  return result;
}
async function renderPage(job) {
  const canvas=$('document-canvas');
  let page;
  if(state.pdf) {
    page=await state.pdf.getPage(state.page);alive(job);
    const base=page.getViewport({scale:1,rotation:(page.rotate+state.rotation)%360});
    const scale=Math.min(2.6,2400/Math.max(base.width,base.height));
    const viewport=page.getViewport({scale,rotation:(page.rotate+state.rotation)%360});
    canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    state.renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport});
    await state.renderTask.promise;state.renderTask=null;alive(job);
    state.width=base.width;state.height=base.height;
  } else if(state.image) {
    const im=state.image,quarter=state.rotation%180!==0;
    const width=quarter?im.height:im.width,height=quarter?im.width:im.height;
    const scale=Math.min(1,2600/Math.max(width,height));
    canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
    const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.save();ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(state.rotation*Math.PI/180);ctx.scale(scale,scale);ctx.drawImage(im,-im.width/2,-im.height/2);ctx.restore();
    state.width=canvas.width;state.height=canvas.height;
  }
  return page;
}
async function readPage({force=false}={}) {
  const job=++state.job;
  setBusy(true);progress('Abriendo la página…',5);
  resetFields();
  try {
    const page=await renderPage(job);alive(job);
    const saved=state.results.get(state.page);
    if(saved&&!force){showResult(saved.result,saved);return;}
    const mode=$('reading-mode').value;
    if(mode==='manual') {showResult(null);remember();return;}
    if(page) {
      progress('Extrayendo el texto del PDF…',50);
      const pdf=await getPdfLibrary();alive(job);
      const content=await page.getTextContent();alive(job);
      const viewport=page.getViewport({scale:1});
      const tokens=content.items.filter(t=>t.str?.trim()).map(t=>{
        const m=pdf.Util.transform(viewport.transform,t.transform);
        return {text:t.str,x:m[4],y:m[5],width:t.width,height:t.height||Math.hypot(m[2],m[3])};
      });
      let result=extractFields(tokens,{width:viewport.width,height:viewport.height,source:'pdf'});
      result.width=viewport.width;result.height=viewport.height;
      if(mode==='auto'&&(!result.client||result.liters===null)) result=await ocrCanvas($('document-canvas'),job);
      alive(job);showResult(result);
      if(mode==='pdf'&&!tokens.length)status('Este PDF es un escaneo. Selecciona «Automática + OCR local» o introduce los datos manualmente.','warning');
    } else if(mode==='auto') {
      showResult(await ocrCanvas($('document-canvas'),job));
    } else {
      showResult(null);status('Imagen cargada. Para leerla, selecciona «Automática + OCR local» o escribe los datos manualmente.','warning');badge('Imagen','warning');
    }
    alive(job);remember();progress('Lectura terminada',100);
  } catch(error) {
    if(job!==state.job||error.name==='AbortError'||error.name==='RenderingCancelledException')return;
    status(error.message||'No se ha podido leer esta página. Puedes introducir los datos manualmente.','error');badge('Revisar','warning');
  } finally {if(job===state.job)setBusy(false);}
}

async function openFile(file) {
  if(!file||state.busy)return;
  const ext=file.name.split('.').pop().toLowerCase();
  if(!['pdf','jpg','jpeg','png','webp'].includes(ext)){status('Elige un PDF, JPG, PNG o WEBP.','error');return;}
  if(file.size>25*1024*1024){status('Este archivo supera los 25 MB. Abre una copia más pequeña.','error');return;}
  const job=++state.job;setBusy(true);resetFields();
  $('document-view').hidden=true;$('dropzone').hidden=false;
  progress('Abriendo el documento…',5);
  try {
    if(state.pdf)await state.pdf.destroy();
    if(state.image?.close)state.image.close();
    state.pdf=null;state.image=null;state.file=file;state.page=1;state.pages=1;state.rotation=0;state.zoom=1;state.results.clear();
    if(ext==='pdf') {
      const pdf=await getPdfLibrary();alive(job);
      const data=new Uint8Array(await file.arrayBuffer());alive(job);
      state.loadingTask=pdf.getDocument({data,standardFontDataUrl:new URL('./vendor/standard_fonts/',import.meta.url).href,cMapUrl:new URL('./vendor/cmaps/',import.meta.url).href,cMapPacked:true,wasmUrl:new URL('./vendor/wasm/',import.meta.url).href,isEvalSupported:false,enableXfa:false});
      state.pdf=await state.loadingTask.promise;state.loadingTask=null;alive(job);state.pages=state.pdf.numPages;
    } else {
      // Bitmap decoding honours camera orientation without sending the photo anywhere.
      state.image=await createImageBitmap(file,{imageOrientation:'from-image'});alive(job);
    }
    $('file-name').textContent=file.name;$('file-size').textContent=(file.size/1024/1024>=1?(file.size/1024/1024).toFixed(1)+' MB':Math.ceil(file.size/1024)+' KB');
    $('dropzone').hidden=true;$('document-view').hidden=false;zoom(0);setBusy(false);
    await readPage();
  } catch(error) {
    if(job!==state.job)return;
    state.file=null;state.pdf=null;state.image=null;
    const message=error.name==='PasswordException'?'El PDF está protegido con contraseña. Abre una copia sin contraseña.':'No se ha podido abrir el archivo. Comprueba que sea un PDF o una imagen válida.';
    status(message,'error');badge('Error','warning');setBusy(false);
  }
}
function zoom(delta) {
  state.zoom=Math.min(2.5,Math.max(.75,Math.round((state.zoom+delta)*100)/100));
  $('canvas-wrap').style.width=`${state.zoom*100}%`;$('zoom-label').textContent=Math.round(state.zoom*100)+' %';controls();
}
async function cancel() {
  state.job++;state.renderTask?.cancel();state.renderTask=null;
  if(state.loadingTask){await state.loadingTask.destroy().catch(()=>{});state.loadingTask=null;}
  if(state.worker){await state.worker.terminate().catch(()=>{});state.worker=null;}
  setBusy(false);status('Lectura cancelada. Puedes completar los datos manualmente o abrir otro documento.','warning');badge('Cancelado','warning');
}
function downloadResult() {
  const data=validity(true);if(!data.ok)return false;
  const blob=new Blob([csvText(data.client,data.liters,data.deliveryDate,data.deliveryTime)],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;
  const stem=(state.file?.name.replace(/\.[^.]+$/,'')||'albaran').replace(/[^a-z0-9_-]/gi,'_').slice(0,80);
  a.download=stem+`_pagina-${state.page}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('CSV descargado. Puedes abrirlo en Excel.');return true;
}
function setManualValues(client,liters,deliveryDate,deliveryTime) {
  if(state.busy)throw new Error('Espera a que termine la lectura.');
  if(typeof client!=='string'||client.trim().length<3||client.length>200||typeof liters!=='number'||!Number.isFinite(liters)||liters<=0||liters>10000000)throw new Error('Nombre o litros no válidos.');
  if(deliveryDate!==undefined&&(typeof deliveryDate!=='string'||!parseDeliveryDate(deliveryDate)))throw new Error('Fecha de entrega no válida.');
  if(deliveryTime!==undefined&&(typeof deliveryTime!=='string'||!parseDeliveryTime(deliveryTime)))throw new Error('Hora de entrega no válida.');
  $('client').value=clean(client);$('liters').value=numberES(liters);$('reviewed').checked=false;
  if(deliveryDate!==undefined)$('delivery-date').value=parseDeliveryDate(deliveryDate);
  if(deliveryTime!==undefined)$('delivery-time').value=parseDeliveryTime(deliveryTime);
  badge('Editado','warning');validity();remember();
  return {client:clean($('client').value),liters:parseLiters($('liters').value),deliveryDate:parseDeliveryDate($('delivery-date').value),deliveryTime:parseDeliveryTime($('delivery-time').value),reviewed:false};
}

$('change-file').addEventListener('click',()=>$('file-input').click());
$('dropzone').addEventListener('click',()=>{if(!state.busy)$('file-input').click();});
$('dropzone').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&!state.busy){e.preventDefault();$('file-input').click();}});
$('file-input').addEventListener('change',e=>{const file=e.target.files[0];e.target.value='';void openFile(file);});
for(const type of ['dragenter','dragover'])$('dropzone').addEventListener(type,e=>{e.preventDefault();if(!state.busy)$('dropzone').classList.add('dragging');});
for(const type of ['dragleave','drop'])$('dropzone').addEventListener(type,e=>{e.preventDefault();$('dropzone').classList.remove('dragging');});
$('dropzone').addEventListener('drop',e=>{if(e.dataTransfer.files.length>1)toast('Se abrirá el primer archivo. Procesa un documento cada vez.');void openFile(e.dataTransfer.files[0]);});
$('reading-mode').addEventListener('change',()=>{state.results.clear();if(state.file)void readPage({force:true});else {resetFields();if($('reading-mode').value==='manual')showResult(null);else {status('Empieza seleccionando una nota de entrega.');badge('Sin documento');}}});
for(const [id,direction] of [['prev-page',-1],['next-page',1]])$(id).addEventListener('click',()=>{if(state.busy)return;remember();state.page+=direction;state.rotation=0;void readPage();});
$('zoom-in').addEventListener('click',()=>zoom(.25));$('zoom-out').addEventListener('click',()=>zoom(-.25));
$('rotate').addEventListener('click',()=>{remember();state.rotation=(state.rotation+90)%360;void readPage({force:$('reading-mode').value==='auto'&&(!state.result||state.result.source==='ocr')});});
$('cancel').addEventListener('click',()=>void cancel());
for(const id of ['client','liters','delivery-date','delivery-time'])$(id).addEventListener('input',()=>{$('reviewed').checked=false;badge('Editado','warning');validity();remember();});
$('liters').addEventListener('blur',()=>{if($('liters').value)validity(true);});
$('reviewed').addEventListener('change',()=>{validity(true);remember();if($('reviewed').checked&&validity().ok)badge('Revisado','ready');else badge('Revisar','warning');});
$('result-form').addEventListener('submit',e=>{e.preventDefault();downloadResult();});
$('copy').addEventListener('click',async()=>{
  const data=validity(true);if(!data.ok)return;
  const value=`Cliente\tLitros\tFecha de entrega\tHora de entrega\n${data.client}\t${numberES(data.liters)}\t${formatDeliveryDate(data.deliveryDate)}\t${data.deliveryTime}`;
  try{await navigator.clipboard.writeText(value);toast('Datos de la entrega copiados.');}
  catch{const el=document.createElement('textarea');el.value=value;el.style.position='fixed';el.style.opacity='0';document.body.append(el);el.select();const success=document.execCommand('copy');el.remove();toast(success?'Datos de la entrega copiados.':'No se pudo copiar. Descarga el CSV.');}
});
window.addEventListener('beforeunload',()=>{state.worker?.terminate();state.image?.close?.();});

// Optional browser agent interface. The normal reader never invokes an AI service.
if(document.modelContext?.registerTool) {
  const lifecycle=new AbortController();
  const specs=[
    {name:'read_extracted_fields',title:'Consultar datos de la entrega',description:'Devuelve cliente, litros, fecha de entrega (AAAA-MM-DD), hora y revisión de la página seleccionada.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:()=>({client:clean($('client').value),liters:parseLiters($('liters').value),deliveryDate:parseDeliveryDate($('delivery-date').value),deliveryTime:parseDeliveryTime($('delivery-time').value),reviewed:$('reviewed').checked,page:state.page,method:state.result?.source||'manual'})},
    {name:'stage_manual_fields',title:'Editar datos de la entrega',description:'Rellena los campos editables; requiere revisión posterior. No exporta ni confirma los datos. Las fechas no cambian de zona horaria.',inputSchema:{type:'object',properties:{client:{type:'string',minLength:3,maxLength:200},liters:{type:'number',exclusiveMinimum:0,maximum:10000000},deliveryDate:{type:'string',description:'Fecha AAAA-MM-DD o DD/MM/AAAA'},deliveryTime:{type:'string',description:'Hora HH:mm o HH:mm:ss'}},required:['client','liters'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:input=>{if(!input||Object.keys(input).some(k=>!['client','liters','deliveryDate','deliveryTime'].includes(k)))throw new Error('Entrada no válida.');return setManualValues(input.client,input.liters,input.deliveryDate,input.deliveryTime);}}
  ];
  for(const spec of specs){try{Promise.resolve(document.modelContext.registerTool(spec,{signal:lifecycle.signal})).catch(()=>{});}catch{}}
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
controls();validity();
