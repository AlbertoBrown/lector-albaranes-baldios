// Deterministic field extraction. No remote calls and no language model.
export const clean = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const plain = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

export function parseDeliveryDate(value) {
  const s=clean(value).replace(/\s/g,'');
  const iso=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const local=/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if(!iso&&!local)return null;
  const [year,month,day]=iso?[+iso[1],+iso[2],+iso[3]]:[+local[3],+local[2],+local[1]];
  const leap=year%4===0&&(year%100!==0||year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if(year<1000||year>9999||month<1||month>12||day<1||day>days[month-1])return null;
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

export function parseDeliveryTime(value) {
  const m=/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(clean(value).replace(/\s/g,''));
  if(!m||+m[1]>23||+m[2]>59||(m[3]!==undefined&&+m[3]>59))return null;
  return m[1].padStart(2,'0')+':'+m[2]+(m[3]!==undefined?':'+m[3]:'');
}

export function formatDeliveryDate(value) {
  const d=parseDeliveryDate(value);
  return d?d.split('-').reverse().join('/'):'';
}

export function parseLiters(value) {
  let s = clean(value).replace(/\s/g, '').replace(/(?:litros?|ltr|lts?|l)$/i, '');
  if (!s || !/^\d[\d.,]*$/.test(s)) return null;
  if (s.includes(',')) {
    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,3}$/.test(s)) return null;
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes('.')) {
    if (/^\d{1,3}(?:\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    else if (!/^\d+\.\d{1,3}$/.test(s)) return null;
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n <= 10000000 ? n : null;
}

export function groupLines(input) {
  const tokens = input.filter(t => clean(t.text)).map(t => ({...t, text:clean(t.text)}));
  tokens.sort((a,b) => a.y-b.y || a.x-b.x);
  const lines=[];
  for (const t of tokens) {
    const tolerance = Math.max(2, Math.min(t.height || 10, 25) * .42);
    let line = lines.findLast(l => Math.abs(l.y-t.y) <= Math.max(tolerance, l.height*.38));
    if (!line) { line = {y:t.y,height:t.height || 10,tokens:[]}; lines.push(line); }
    line.tokens.push(t);
    line.height = Math.max(line.height,t.height || 0);
  }
  for (const l of lines) { l.tokens.sort((a,b)=>a.x-b.x); l.text=l.tokens.map(t=>t.text).join(' '); }
  return lines.sort((a,b)=>a.y-b.y);
}

function box(tokens) {
  if (!tokens.length) return null;
  const x=Math.min(...tokens.map(t=>t.x));
  const top=Math.min(...tokens.map(t=>t.y-(t.height||10)));
  return {x:x-2,y:top-2,width:Math.max(...tokens.map(t=>t.x+t.width))-x+4,height:Math.max(...tokens.map(t=>t.y))-top+4};
}

function nameValid(value) {
  return value.length>=4 && /[A-ZÁÉÍÓÚÑÜa-záéíóúñü]{2}/.test(value) && !/^(?:NIF|CIF|CALLE|CL\b|CODIGO|TEL[EÉ]FONO|NOMBRE|LOCALIDAD|PRODUCTO|GAS[OÓ]LEO|FECHA|FIRMA|CONDUCTOR|EXPEDIDOR)/i.test(value);
}

export function extractFields(tokens, {width=595,height=842,source='pdf'}={}) {
  const lines=groupLines(tokens);
  const warnings=[];
  const result={client:'',liters:null,deliveryDate:'',deliveryTime:'',clientSource:'',litersSource:'',deliverySource:'',clientBox:null,litersBox:null,deliveryDateBox:null,deliveryTimeBox:null,warnings,source,text:lines.map(l=>l.text).join('\n')};
  let primaryName=null, secondaryName=null;
  const nameLabel=/(?:\(\s*4\s*c\s*\)|\b4c[\])]?)[\s:]*Nombre\s*[:|]?\s*/i;
  for (const l of lines) {
    const match=nameLabel.exec(l.text);
    if (!match) continue;
    const value=clean(l.text.slice(match.index+match[0].length).split(/\([456][a-z]\)/i)[0]).replace(/^[|:]+|[|]+$/g,'').trim();
    if (nameValid(value)) {
      let after=0;
      const selected=l.tokens.filter(t=>{const end=after+t.text.length; const keep=end>match.index+match[0].length;after=end+1;return keep;});
      primaryName={value,box:box(selected)};
      break;
    }
  }
  // Customer block below the delivery signature. Never use "Nombre receptor".
  const customerHeader=lines.find(l=>/Datos\s+(?:del\s+)?cliente/i.test(l.text));
  if (customerHeader) {
    const productStart=customerHeader.tokens.find(t=>/^Producto$/i.test(t.text));
    const end=productStart?.x ?? width*.43;
    const row=lines.find(l=>l.y>customerHeader.y+customerHeader.height*.5&&l.y<customerHeader.y+customerHeader.height*3.1);
    if(row) {
      const selected=row.tokens.filter(t=>t.x<end-width*.012);
      const value=clean(selected.map(t=>t.text).join(' '));
      if(nameValid(value)) secondaryName={value,box:box(selected)};
    }
  }
  const name=primaryName||secondaryName;
  if(name) {result.client=name.value;result.clientBox=name.box;result.clientSource=primaryName?'(4c) Nombre · destinatario':'Bloque Datos cliente';}
  if(primaryName&&secondaryName&&plain(primaryName.value)!==plain(secondaryName.value)) warnings.push('El destinatario y «Datos cliente» no coinciden. Revisa el nombre.');

  // Read only the labelled delivery row, never document metadata or other dates.
  const deliveryRow=lines.find(l=>/Fecha\s+(?:de\s+)?entrega\b/i.test(l.text));
  if(deliveryRow) {
    const match=/Fecha\s+(?:de\s+)?entrega\b/i.exec(deliveryRow.text);
    let offset=0;
    const labels=deliveryRow.tokens.filter(t=>{
      const start=offset,end=start+t.text.length;offset=end+1;
      return end>match.index&&start<match.index+match[0].length;
    });
    const labelRight=Math.max(...labels.map(t=>t.x+t.width));
    const labelHeight=Math.max(...labels.map(t=>t.height||10));
    const top=Math.min(...labels.map(t=>t.y))-labelHeight*.55;
    const bottom=Math.max(...labels.map(t=>t.y))+labelHeight*.65;
    const region=tokens.filter(t=>t.x>=labelRight-width*.008&&t.y>=top&&t.y<=bottom).sort((a,b)=>a.x-b.x);
    const regionText=region.map(t=>clean(t.text)).join(' ');
    const findValues=(regex,parser)=>{
      const found=[];
      for(const m of regionText.matchAll(regex)) {
        const value=parser(m[0]);if(!value)continue;
        let position=0;
        const selected=region.filter(t=>{const start=position,end=start+clean(t.text).length;position=end+1;return end>m.index&&start<m.index+m[0].length;});
        found.push({value,box:box(selected)});
      }
      return found;
    };
    const dates=findValues(/\b(?:\d{4}\s*-\s*\d{2}\s*-\s*\d{2}|\d{1,2}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{4})\b/g,parseDeliveryDate);
    const times=findValues(/\b\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?\b/g,parseDeliveryTime);
    if(new Set(dates.map(d=>d.value)).size===1){result.deliveryDate=dates[0].value;result.deliveryDateBox=dates[0].box;}
    if(new Set(times.map(t=>t.value)).size===1){result.deliveryTime=times[0].value;result.deliveryTimeBox=times[0].box;}
    if(result.deliveryDate||result.deliveryTime)result.deliverySource='(6g) Fecha de entrega · fecha y hora del documento';
  }

  function amountsUnder(header,anchor,stopX,requireUnit) {
    const rowLimit=header.y+header.height*4.5;
    const candidates=[];
    for(const row of lines.filter(l=>l.y>header.y+header.height*.55&&l.y<rowLimit)) {
      if(/Lugar y datos|entrega|Observaciones|B\. IMPONIBLE/i.test(row.text)) break;
      if(requireUnit && !/\b(?:LTR|LITROS?|LTS?)\b/i.test(row.text)) continue;
      if(!requireUnit && !/GAS[OÓ0]LE[O0]|GASOLINA|DIESEL|G[O0][ABC]\b/i.test(row.text)) continue;
      const numeric=row.tokens.filter(t=>t.x>=anchor.x-width*.016&&t.x<stopX).filter(t=>parseLiters(t.text)!==null);
      for(const t of numeric) candidates.push({value:parseLiters(t.text),box:box([t])});
    }
    return candidates;
  }
  let primaryAmounts=[],secondaryAmounts=[];
  for (const l of lines) {
    if(!/Cantidad/i.test(l.text)) continue;
    const label=l.tokens.find(t=>/Cantidad/i.test(t.text));
    if(!label) continue;
    const isPrimary=/\(?5\s*b\)?/i.test(l.text)&&/Unidad|Trazador|Producto/i.test(l.text);
    if(isPrimary) {
      // In OCR the field code and title may be separate words.
      const next=l.tokens.find(t=>t.x>label.x+label.width&&/Trazador|5e/i.test(t.text));
      const code=l.tokens.find(t=>/^[\[(]?5\s*b[\])]?$/.test(t.text)&&t.x<label.x);
      const right=next?(label.x+label.width+next.x)/2:label.x+label.width+width*.012;
      primaryAmounts=amountsUnder(l,code||label,right,true);
    } else if(/Producto/i.test(l.text)&&/Importe|Precio/i.test(l.text)) {
      const next=l.tokens.find(t=>t.x>label.x&&/Importe/i.test(t.text));
      secondaryAmounts=amountsUnder(l,label,next?.x??label.x+width*.13,false);
    }
  }
  if(primaryAmounts.length>1||secondaryAmounts.length>1) {
    warnings.push('Hay varias cantidades o productos. Introduce los litros que corresponden; no se han sumado automáticamente.');
  } else {
    const a=primaryAmounts[0],b=secondaryAmounts[0];
    if(a&&b&&a.value!==b.value) warnings.push('Las dos cantidades del documento no coinciden. Comprueba los litros.');
    else if(a||b) {
      const selected=a||b;
      result.liters=selected.value;result.litersBox=selected.box;
      result.litersSource=a?'(5b) Cantidad · unidad LTR':'Cantidad del producto · Datos cliente';
      if(a&&b) result.litersSource+=' · coincide en ambas zonas';
    }
  }
  if(!result.client) warnings.push('No se ha localizado el cliente con seguridad. Escríbelo manualmente.');
  if(result.liters===null&&!warnings.some(w=>/cantidades|varias cantidades/.test(w))) warnings.push('No se han localizado los litros con seguridad. Escríbelos manualmente.');
  if(!result.deliveryDate)warnings.push('No se ha localizado una fecha de entrega válida. Complétala manualmente.');
  if(!result.deliveryTime)warnings.push('No se ha localizado una hora de entrega válida. Complétala manualmente.');
  if(source==='ocr') warnings.push('Lectura OCR: comprueba letras, cifras y separadores decimales.');
  return result;
}

export function csvText(client,liters,deliveryDate='',deliveryTime='') {
  const cell=value=>'"'+String(value).replace(/^[\s]*[=+@-]/,m=>"'"+m).replace(/"/g,'""')+'"';
  return '\ufeffCliente;Litros;Fecha de entrega;Hora de entrega\r\n'+[clean(client),String(liters).replace('.',','),formatDeliveryDate(deliveryDate),parseDeliveryTime(deliveryTime)||''].map(cell).join(';')+'\r\n';
}
