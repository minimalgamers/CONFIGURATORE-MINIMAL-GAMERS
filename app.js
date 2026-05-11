// JS unico, pulito, senza duplicati
// ═══════════════════════════════════════════════════════════════

const MOLT = 1.22; // Prezzo componente = fornitore × IVA 22%
const IVA  = 1.22;
const IMPL = 0.30; // Costo implementazione 30%

// ── STEPS ────────────────────────────────────────────────────
const STEPS = [
  {id:'piattaforma', name:'Piattaforma',  sub:'Brand e socket'},
  {id:'cpu',         name:'CPU',          sub:'Processore'},
  {id:'mobo',        name:'Scheda Madre', sub:'Socket compatibile'},
  {id:'case',        name:'Case',         sub:'Chassis compatibile'},
  {id:'ram',         name:'RAM',          sub:'DDR4 o DDR5'},
  {id:'gpu',         name:'GPU',          sub:'Scheda video'},
  {id:'ssd',         name:'SSD',          sub:'Storage NVMe'},
  {id:'psu',         name:'PSU',          sub:'Alimentatore'},
  {id:'cooler',      name:'Dissipatore',  sub:'Cooling CPU'},
  {id:'ventole',     name:'Extra',        sub:'Kit ventole'},
  {id:'riepilogo',   name:'Riepilogo',    sub:'Ordina'},
];

const CAT = {
  case:'Case', cpu:'CPU', mobo:'Scheda Madre', ram:'RAM',
  gpu:'GPU', ssd:'SSD', psu:'PSU', cooler:'Dissipatore', ventole:'Extra',
};

const BLD_LBL = {
  cpu:'CPU', mobo:'Scheda Madre', case:'Case', ram:'RAM',
  gpu:'GPU', ssd:'SSD', psu:'Alimentatore', cooler:'Dissipatore', ventole:'Kit Ventole',
};

const DESCS = {
  cpu:   'Filtrata per socket scelto. X3D = massimo gaming. No-fan = devi comprare il dissipatore.',
  mobo:  'Filtrata per socket CPU. Cerca WiFi integrato se non hai ethernet. DDR mostrato è quello compatibile.',
  case:  'Filtrato per form factor della tua scheda madre. ATX→ATX/mATX/ITX · mATX→mATX/ITX · ITX→solo ITX.',
  ram:   'DDR filtrata automaticamente per la tua mobo. AM5/LGA1851→DDR5 · AM4→DDR4 · 32GB DDR5-6000 è il punto dolce.',
  gpu:   'La scheda video determina le prestazioni gaming più di ogni altro componente.',
  ssd:   'NVMe PCIe 4.0 da 1TB è il minimo consigliato. PCIe 5.0 per i più esigenti.',
  psu:   'L\'alimentatore deve avere margine sul consumo stimato. Consigliamo almeno 100W in più del necessario.',
  cooler:'AIO 360mm per CPU ad alto TDP (>125W). Torre Noctua/be quiet! per build silenziose.',
  ventole:'Opzionale — migliora il flusso d\'aria e l\'estetica con ventole ARGB aggiuntive.',
};

// ── STATE ─────────────────────────────────────────────────────
let state = {
  step: 0,
  piattaforma: null,
  socket: null,
  build: {
    case: null, cpu: null, mobo: null, ram: null,
    gpu: null, ssd: null, psu: null, cooler: null, ventole: null,
  },
  filters: {},
  search: {},
};

let PRODS = [];

// ── PRODOTTI ──────────────────────────────────────────────────
// (funzione separata per non bloccare il parsing del JS)
function loadProdotti() {
  // Prodotti caricati via fetch da prodotti.json
}

async function fetchProdotti() {
  try {
    const r = await fetch('prodotti.json?v=' + Date.now());
    if (!r.ok) throw new Error('HTTP ' + r.status);
    PRODS = await r.json();
    // Post-processing form factor
    PRODS.forEach(p => {
      if(p.c==='Scheda Madre'&&!p._ff){const n=p.d.toUpperCase();if(/E-ATX|EATX/.test(n))p._ff='E-ATX';else if(/MATX|MICRO.ATX|UATX/.test(n))p._ff='mATX';else if(/MINI.ITX|\bITX\b/.test(n))p._ff='ITX';else p._ff='ATX';}
      if(p.c==='Case'&&!p._maxff){const n=p.d.toUpperCase();if(/FULL TOWER|BIG TOWER/.test(n))p._maxff='E-ATX';else if(/MINI.ITX TOWER|A4.SFX|MESHROOM/.test(n))p._maxff='ITX';else if(/MICRO.ATX|MATX|MINI TOWER|MINI-TOWER/.test(n))p._maxff='mATX';else p._maxff='ATX';}
    });
  } catch(e) {
    const c=document.getElementById('mainContent');
    if(c) c.innerHTML='<div style="padding:60px;text-align:center;font-family:monospace;color:#d946a8">⚠️ Errore caricamento prodotti. Ricaricare la pagina.</div>';
  }
}


// ── UTILITY ───────────────────────────────────────────────────
const fmt  = p => '€ ' + (p * MOLT).toFixed(2).replace('.',',');
const fmtR = p => '€ ' + (p * MOLT / 36).toFixed(2).replace('.',',');
const calcImpl = tot => tot * IMPL; // Costo implementazione sul totale
const fmtImpl = tot => '€ ' + (tot * IMPL).toFixed(2).replace('.',',');
const calcTotale = tot => tot + tot * IMPL; // Totale finale con implementazione
const calcP = p => p * MOLT;
const trunc = (s, n) => s.length > n ? s.slice(0, n) + '…' : s;

function scrollToNext() {
  requestAnimationFrame(() => {
    const btn = document.querySelector('.btn-next:not(:disabled)');
    if (btn) btn.scrollIntoView({behavior:'smooth', block:'center'});
  });
}
function scrollToTop() {
  window.scrollTo({top:0, behavior:'smooth'});
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

// ── COMPATIBILITÀ ─────────────────────────────────────────────
function isCompat(stepId, p) {
  const b  = state.build;
  const pi = state.piattaforma;
  const sk = state.socket;

  if (stepId === 'cpu') {
    if (sk && p.socket !== sk) return false;
    if (!sk) {
      if (pi === 'amd'   && p.platform !== 'AMD')   return false;
      if (pi === 'intel' && p.platform !== 'INTEL') return false;
    }
    return true;
  }

  if (stepId === 'mobo') {
    if (b.cpu && b.cpu.socket) return p.socket === b.cpu.socket;
    if (sk) return p.socket === sk;
    if (pi === 'amd'   && p.platform !== 'AMD')   return false;
    if (pi === 'intel' && p.platform !== 'INTEL') return false;
    return true;
  }

  if (stepId === 'case') {
    if (b.mobo && b.mobo._ff) {
      const ORDER = ['ITX','mATX','ATX','E-ATX'];
      const cff = p._maxff || 'ATX';
      return ORDER.indexOf(cff) >= ORDER.indexOf(b.mobo._ff);
    }
    return true;
  }

  if (stepId === 'ram') {
    if (b.mobo && b.mobo.ddr && p.ddr) return p.ddr === b.mobo.ddr;
    if (b.mobo && b.mobo.socket) {
      const ddr5 = ['AM5','LGA1851'];
      const ddr4 = ['AM4','LGA1200'];
      if (ddr5.includes(b.mobo.socket) && p.ddr === 'DDR4') return false;
      if (ddr4.includes(b.mobo.socket) && p.ddr === 'DDR5') return false;
    }
    return true;
  }

  return true;
}

function getIncompatReason(stepId, p) {
  const b = state.build;
  if (stepId === 'mobo' && b.cpu?.socket && p.socket !== b.cpu.socket)
    return `Socket ${p.socket} — CPU richiede ${b.cpu.socket}`;
  if (stepId === 'ram' && b.mobo?.ddr && p.ddr && p.ddr !== b.mobo.ddr)
    return `${p.ddr} — Mobo richiede ${b.mobo.ddr}`;
  if (stepId === 'case' && b.mobo?._ff) {
    const ORDER = ['ITX','mATX','ATX','E-ATX'];
    const cff = p._maxff || 'ATX';
    if (ORDER.indexOf(cff) < ORDER.indexOf(b.mobo._ff))
      return `Case ${cff} — Mobo è ${b.mobo._ff}`;
  }
  return null;
}

// ── PRODOTTI FILTRATI ─────────────────────────────────────────
function getProds(sid) {
  const cat  = CAT[sid];
  const ab   = state.filters[sid] || [];
  const q    = (state.search[sid] || '').toLowerCase().trim();
  return PRODS.filter(p => {
    if (p.c !== cat) return false;
    if (!isCompat(sid, p)) return false;
    if (ab.length && !ab.includes(p.b)) return false;
    if (q && !p.d.toLowerCase().includes(q) && !(p.b||'').toLowerCase().includes(q)) return false;
    return true;
  });
}

function getBrands(sid) {
  const cat = CAT[sid];
  const brands = [...new Set(
    PRODS.filter(p => p.c === cat && isCompat(sid, p)).map(p => p.b).filter(Boolean)
  )].sort();
  return brands;
}

// ── BADGE INTELLIGENTI ────────────────────────────────────────
function getBadges(p, sid, allProds) {
  const badges = [];
  const cat    = CAT[sid];
  if (!cat) return badges;

  const avail = allProds.filter(x => x.c === cat && x.stock > 0);

  // Miglior prezzo
  if (avail.length) {
    const minP = Math.min(...avail.map(x => x.p));
    if (p.p === minP && p.stock > 0) badges.push({cls:'best-price', label:'💰 Miglior prezzo'});
  }

  // Più richiesto (stock alto = rotazione alta)
  const stocks = avail.filter(x => x.stock < 99).map(x => x.stock);
  if (stocks.length) {
    const maxS = Math.max(...stocks);
    if (maxS > 5 && p.stock === maxS) badges.push({cls:'popular', label:'⭐ Più richiesto'});
  }

  // Nuova generazione
  if (cat === 'GPU') {
    const n = p.d.toUpperCase();
    if (/RTX\s*50|RX\s*90/.test(n)) badges.push({cls:'new-gen', label:'🆕 Nuova gen'});
  }

  // Top gaming (X3D)
  if (cat === 'CPU' && /X3D/.test(p.d.toUpperCase()))
    badges.push({cls:'recommended', label:'🎮 Top gaming'});

  return badges;
}

// ── SUGGERIMENTI INTELLIGENTI ─────────────────────────────────
function getSmartTip(sid) {
  const b = state.build;
  const tips = [];

  if (sid === 'psu' && b.cpu && b.gpu) {
    const tot  = (b.cpu._tdp||65) + (b.gpu._tdp||150) + 50;
    const rec  = tot < 400 ? 650 : tot < 550 ? 750 : tot < 700 ? 850 : 1000;
    tips.push(`💡 Consumo stimato ~${tot}W → consigliamo almeno <strong>${rec}W</strong>`);
  }

  if (sid === 'cooler' && b.cpu) {
    const tdp = b.cpu._tdp || 65;
    if (tdp >= 170)      tips.push('🌡️ CPU ad alto TDP: consigliamo <strong>AIO 360mm</strong>');
    else if (tdp >= 105) tips.push('🌡️ Consigliamo <strong>AIO 240mm</strong> o tower premium (Noctua, be quiet!)');
  }

  if (sid === 'ram' && b.mobo?.socket === 'AM5')
    tips.push('💡 Su AM5 usa <strong>DDR5-6000 CL30</strong> per il massimo gaming');

  if (sid === 'gpu' && b.cpu) {
    const n = b.cpu.d.toUpperCase();
    if (/I5-1[234]|RYZEN 5/.test(n))
      tips.push('⚖️ Con questa CPU evita RTX 5080/5090 — rischi <strong>CPU bottleneck</strong> a 1080p');
  }

  if (sid === 'mobo')
    tips.push('📡 Consigliamo mobo con <strong>WiFi integrato</strong> se non hai ethernet vicino al PC');

  return tips;
}

// ── SCALAPAY DINAMICO ─────────────────────────────────────────
function updateScalapayBar() {
  const tot = Object.values(state.build)
    .filter(Boolean)
    .reduce((s, p) => s + calcP(p.p), 0);
  const bar = document.getElementById('scalaPayBar');
  if (!bar) return;
  if (tot > 0) {
    bar.classList.remove('hidden');
    const totFinale = calcTotale(tot);
    document.getElementById('spTotal').textContent = '€ ' + totFinale.toFixed(2).replace('.',',');
    document.getElementById('spRate').textContent  = '€ ' + (totFinale/36).toFixed(2).replace('.',',');
  } else {
    bar.classList.add('hidden');
  }
}

// ── RENDER PRINCIPALE ─────────────────────────────────────────

// ════════════════════════════════════════════════════════════
// SISTEMA SOTTOCATEGORIE — card di selezione per ogni step
// ════════════════════════════════════════════════════════════
const SUBCATS = {
  cpu: {label:'Linea processore',desc:'Scegli la famiglia di processori. Puoi tornare indietro in qualsiasi momento.',field:'_linea',groups:[
    {group:'AMD Ryzen',items:[
      {val:'Ryzen 9',icon:'🔴',note:'Massime prestazioni gaming e produttività',tag:'High-End'},
      {val:'Ryzen 7',icon:'🔴',note:'Ottimo bilanciamento prestazioni/prezzo',tag:'Mid-High'},
      {val:'Ryzen 5',icon:'🔴',note:'Gaming ottimale al miglior prezzo',tag:'Mid'},
      {val:'Ryzen 3',icon:'🔴',note:'Entry level, build budget',tag:'Entry'},
    ]},
    {group:'Intel Core Ultra — LGA1851',items:[
      {val:'Core Ultra 9',icon:'🔵',note:'Flagship Intel 2025, AI NPU integrata',tag:'Flagship'},
      {val:'Core Ultra 7',icon:'🔵',note:'High-end con architettura ibrida moderna',tag:'High-End'},
      {val:'Core Ultra 5',icon:'🔵',note:'Mid-range performante, ottimo per gaming',tag:'Mid'},
    ]},
    {group:'Intel Core i — LGA1700',items:[
      {val:'Core i9',icon:'🔵',note:'Massimo overclock Intel, top gaming e produttività',tag:'High-End'},
      {val:'Core i7',icon:'🔵',note:'Potente per gaming e content creation',tag:'Mid-High'},
      {val:'Core i5',icon:'🔵',note:'Il sweet spot Intel per il gaming',tag:'Mid'},
      {val:'Core i3',icon:'🔵',note:'Budget Intel, buon gaming 1080p',tag:'Budget'},
    ]},
  ]},
  mobo: {label:'Chipset',desc:'Il chipset determina le funzionalità della tua scheda madre. Solo chipset compatibili con la CPU scelta.',field:'_chipset',dynamic:true,
    all_groups:{
      'AM5':[
        {val:'X870E',tag:'Flagship',note:'PCIe 5.0 completo, USB4, Wi-Fi 7. Massimo OC'},
        {val:'X870', tag:'High-End',note:'PCIe 5.0, USB4, Wi-Fi 7 obbligatorio'},
        {val:'B850', tag:'Consigliato',note:'PCIe 5.0 M.2, buon OC. Sweet spot AM5 2025'},
        {val:'B650E',tag:'Mid',note:'PCIe 5.0 GPU slot, feature bilanciate'},
        {val:'B650', tag:'Mid',note:'Entry AM5 con buone funzionalità'},
        {val:'B840', tag:'Entry',note:'Budget AM5, no OC CPU'},
        {val:'A620', tag:'Budget',note:'Minimo AM5, no overclocking'},
      ],
      'AM4':[
        {val:'X570',tag:'High-End',note:'Top AM4: PCIe 4.0, VRM premium'},
        {val:'B550',tag:'Mid',note:'Sweet spot AM4: PCIe 4.0, ottimo Ryzen 5000'},
        {val:'B450',tag:'Budget',note:'Budget AM4 con supporto Ryzen 5000'},
        {val:'A520',tag:'Entry',note:'Entry AM4, no OC'},
      ],
      'LGA1851':[
        {val:'Z890',tag:'High-End',note:'Top Arrow Lake: OC completo, DDR5-8000+'},
        {val:'B860',tag:'Mid',note:'Mid LGA1851, no CPU OC, ottimo valore'},
        {val:'H810',tag:'Budget',note:'Entry LGA1851, funzioni base'},
      ],
      'LGA1700':[
        {val:'Z790',tag:'High-End',note:'Overclocking completo, PCIe 5.0'},
        {val:'B760',tag:'Consigliato',note:'Sweet spot Intel: buone feature, no CPU OC'},
        {val:'Z690',tag:'Mid',note:'Generazione Z precedente, ancora valida'},
        {val:'H770',tag:'Mid',note:'Più feature del B760 senza OC'},
        {val:'H610',tag:'Budget',note:'Entry Intel LGA1700'},
      ],
      'LGA1200':[
        {val:'Z590',tag:'Mid',note:'Top LGA1200: OC completo'},
        {val:'B560',tag:'Entry',note:'Mid LGA1200, RAM OC'},
        {val:'H510',tag:'Budget',note:'Entry LGA1200'},
      ],
    }
  },
  ssd: {label:'Tipo di storage',desc:'NVMe è consigliato per OS e giochi. SATA per storage secondario economico.',field:'_tipo',groups:[
    {group:'NVMe PCIe (M.2) — Veloce',items:[
      {val:'NVMe Gen 5',icon:'⚡',note:'7.000–14.000 MB/s. Richiede PCIe 5.0. Massime prestazioni 2025',tag:'Ultra'},
      {val:'NVMe Gen 4',icon:'🔥',note:'3.500–7.400 MB/s. Standard attuale. Consigliato per OS e giochi',tag:'Consigliato'},
      {val:'NVMe Gen 3',icon:'✅',note:'1.800–3.500 MB/s. Veloce, economico, compatibile con tutto',tag:'Budget'},
      {val:'NVMe',      icon:'📦',note:'NVMe senza generazione dichiarata. Velocità variabile',tag:'Vario'},
    ]},
    {group:'SATA — Storage secondario',items:[
      {val:'M.2 SATA',  icon:'💾',note:'Fino a 550 MB/s, form factor M.2. Economico per storage extra',tag:'Legacy'},
      {val:'SATA 2.5"', icon:'💾',note:'Fino a 550 MB/s, slot 2.5". Massima capacità al miglior prezzo',tag:'Legacy'},
    ]},
  ]},
  gpu: {label:'Famiglia GPU',desc:'Scegli la generazione. Potrai poi filtrare per serie specifica.',field:'_fascia_gpu',groups:[
    {group:'NVIDIA GeForce RTX',items:[
      {val:'RTX 50xx',icon:'🟢',note:'Architettura Blackwell 2025. DLSS 4, frame gen multi-frame, massima efficienza',tag:'Nuova gen'},
      {val:'RTX 40xx',icon:'🟢',note:'Architettura Ada Lovelace. Ancora ottima, prezzi scesi significativamente',tag:'Prev gen'},
      {val:'RTX 30xx',icon:'🟢',note:'Architettura Ampere. Budget competitivo per 1080p/1440p',tag:'Legacy'},
    ]},
    {group:'AMD Radeon RX',items:[
      {val:'RX 9xxx',icon:'🔴',note:'Architettura RDNA 4 2025. Ottimo rapporto prezzo/prestazioni vs NVIDIA',tag:'Nuova gen'},
      {val:'RX 7xxx',icon:'🔴',note:'Architettura RDNA 3. Competitivo, prezzi ridotti',tag:'Prev gen'},
    ]},
    {group:'Intel Arc',items:[
      {val:'Arc Bxxx',icon:'🔵',note:'Battlemage 2024. Sorprendente per il prezzo a 1080p/1440p',tag:'Budget'},
      {val:'Arc Axxx',icon:'🔵',note:'Alchemist. Entry level con driver maturi',tag:'Entry'},
    ]},
  ]},
  psu: {label:'Potenza e formato',desc:'Scegli il wattaggio in base alla build. Consigliamo almeno 100W di margine sul consumo stimato.',field:'_fascia_w',groups:[
    {group:'ATX Standard',items:[
      {val:'450–550W',icon:'🔋',note:'Build entry: CPU 65W + GPU ≤ RTX 5060. Ideale per build silenziose',tag:'Budget'},
      {val:'600–650W',icon:'🔋',note:'Build mid: CPU 105W + GPU ≤ RTX 5060 Ti. Buon valore',tag:'Mid'},
      {val:'700–750W',icon:'⚡',note:'Build gaming: CPU 105-125W + GPU ≤ RTX 5070. Sweet spot',tag:'Consigliato'},
      {val:'800–850W',icon:'⚡',note:'Build high-end: CPU 170W + GPU ≤ RTX 5080 / RX 9070 XT',tag:'High-End'},
      {val:'1000W',   icon:'🔥',note:'Build top: RTX 5090, sistema ad altissimo TDP',tag:'Top Build'},
      {val:'1200W+',  icon:'🔥',note:'Workstation / extreme OC / future-proof',tag:'Extreme'},
    ]},
    {group:'Compact (per case ITX/Slim)',items:[
      {val:'SFX',  icon:'📦',note:'SFX standard: fino a 850W. Per case Mini-ITX',tag:'ITX'},
      {val:'SFX-L',icon:'📦',note:'SFX Large: fino a 1000W. Compatibile slot SFX-L',tag:'ITX+'},
      {val:'TFX',  icon:'📦',note:'Tiny Form Factor: case slim e HTPC',tag:'Slim'},
    ]},
  ]},
  cooler: {label:'Tipo di raffreddamento',desc:'AIO per CPU ad alto TDP o build silenziose. Aria per ottimo rapporto qualità/prezzo.',field:'_tipo_cool',groups:[
    {group:'Raffreddamento a liquido AIO',items:[
      {val:'AIO 420mm',icon:'💧',note:'Massimo: CPU >170W TDP (9950X, i9-14900K). Richiede case 420mm',tag:'Extreme'},
      {val:'AIO 360mm',icon:'💧',note:'Ottimo per CPU 105-170W. Standard high-end, silenzioso',tag:'Consigliato'},
      {val:'AIO 280mm',icon:'💧',note:'Buon compromesso tra silenziosità e dimensioni',tag:'Mid'},
      {val:'AIO 240mm',icon:'💧',note:'Entry AIO: silenzioso per CPU ≤105W TDP. Compatibile quasi tutti i case',tag:'Entry'},
      {val:'AIO 120mm',icon:'💧',note:'AIO compatto per build ITX o CPU a basso TDP',tag:'ITX'},
    ]},
    {group:'Raffreddamento ad aria',items:[
      {val:'Dual Tower',  icon:'🌬️',note:'Prestazioni top (Noctua NH-D15): rivaleggiano AIO 280mm, silenziosissimi',tag:'Premium'},
      {val:'Single Tower',icon:'🌬️',note:'Standard: ottimo prezzo/prestazioni per CPU fino a 125W TDP',tag:'Popolare'},
      {val:'Low-Profile', icon:'🌬️',note:'Per case ITX/SFF con altezza limitata (≤92mm)',tag:'ITX'},
    ]},
  ]},
  ram: {label:'Generazione RAM',desc:'DDR5 per piattaforme AM5 e LGA1851. DDR4 per AM4. LGA1700 dipende dalla scheda madre.',field:'ddr',groups:[
    {group:'Tipo memoria',items:[
      {val:'DDR5',icon:'🆕',note:'Standard attuale 2025. Fino a 8000 MHz. Richiesto su AM5 e LGA1851',tag:'Attuale'},
      {val:'DDR4',icon:'✅',note:'Piattaforma AM4: matura, economica, efficiente. Ottimo per build budget',tag:'Budget'},
    ]},
  ]},
};

if(!state.subcat) state.subcat = {};

function setSubcat(sid,val){state.subcat[sid]=val;render();}
function clearSubcat(sid){state.subcat[sid]=null;render();}

function getSubcatProds(sid,allProds){
  const active=state.subcat[sid];
  if(!active||active==='__all__') return allProds;
  const sc=SUBCATS[sid];
  if(!sc) return allProds;
  const W={
    '450–550W':[400,550],'600–650W':[600,650],'700–750W':[700,750],
    '800–850W':[800,850],'1000W':[950,1100],'1200W+':[1100,9999]
  };
  if(sc.field==='_fascia_w'){
    if(['SFX','SFX-L','TFX'].includes(active)) return allProds.filter(p=>p._tipo_psu===active);
    const[wmin,wmax]=W[active]||[0,9999];
    return allProds.filter(p=>p._tipo_psu==='ATX'&&(p._w||0)>=wmin&&(p._w||0)<=wmax);
  }
  return allProds.filter(p=>p[sc.field]===active);
}

function renderSubcatSelector(sid,allProds){
  const sc=SUBCATS[sid];
  if(!sc) return null;
  const active=state.subcat[sid];
  if(active) return `<div class="subcat-back" onclick="clearSubcat('${sid}')">← ${sc.label}: <strong>${active}</strong> <span>— cambia</span></div>`;

  let groups=sc.groups||[];
  if(sc.dynamic){
    const sock=state.build.cpu?.socket||state.socket;
    const chips=(sc.all_groups||{})[sock]||[];
    const avail=chips.filter(cs=>allProds.some(p=>p._chipset===cs.val));
    if(avail.length<=1) return null;
    groups=[{group:`Socket ${sock}`,items:avail}];
  }

  const W={'450–550W':[400,550],'600–650W':[600,650],'700–750W':[700,750],
            '800–850W':[800,850],'1000W':[950,1100],'1200W+':[1100,9999]};

  function cnt(item){
    const v=item.val;
    if(sc.field==='_fascia_gpu') return allProds.filter(p=>p._fascia_gpu===v).length;
    if(sc.field==='_fascia_w'){
      if(['SFX','SFX-L','TFX'].includes(v)) return allProds.filter(p=>p._tipo_psu===v).length;
      const[wmin,wmax]=W[v]||[0,9999];
      return allProds.filter(p=>p._tipo_psu==='ATX'&&(p._w||0)>=wmin&&(p._w||0)<=wmax).length;
    }
    if(sc.dynamic) return allProds.filter(p=>p._chipset===v).length;
    return allProds.filter(p=>p[sc.field]===v).length;
  }

  let h=`<div class="step-header">
    <div class="step-eyebrow">step ${String(state.step+1).padStart(2,'0')} — ${STEPS[state.step].name.toLowerCase()}</div>
    <h1 class="step-title">${sc.label.toUpperCase()}<span class="acc">.</span></h1>
    <p class="step-desc">${sc.desc}</p>
  </div><div class="subcat-grid">`;

  for(const grp of groups){
    h+=`<div class="subcat-group-label">${grp.group}</div><div class="subcat-row">`;
    for(const item of grp.items){
      const c=cnt(item);
      if(!c && allProds.length > 0) continue; // nascondi solo se prodotti caricati
      const sv=item.val.replace(/'/g,"\\'");
      h+=`<button class="subcat-card" onclick="setSubcat('${sid}','${sv}')">
        <span class="subcat-icon">${item.icon||'▸'}</span>
        <span class="subcat-name">${item.val}</span>
        <span class="subcat-tag">${item.tag}</span>
        <span class="subcat-count">${c} prodotti</span>
        <span class="subcat-note">${item.note}</span>
      </button>`;
    }
    h+=`</div>`;
  }
  h+=`</div><button class="btn-skip subcat-skip" onclick="setSubcat('${sid}','__all__')">Mostra tutti i ${allProds.length} prodotti →</button>`;
  return h;
}


// ── IMMAGINI PRODOTTI ─────────────────────────────────────
// Cache immagini per non rifetchare
const IMG_CACHE = {};

// Mappa brand → URL immagine di fallback
const BRAND_IMG = {
  'nzxt':    'https://www.nzxt.com/favicon.ico',
};

// Ottieni placeholder emoji per categoria
function getCatEmoji(cat) {
  const e = {
    'CPU':'🔲', 'GPU':'🖥️', 'RAM':'💾', 'SSD':'💿',
    'Scheda Madre':'🔌', 'Case':'🖥️', 'PSU':'⚡',
    'Dissipatore':'❄️', 'Extra':'🎮'
  };
  return e[cat] || '📦';
}

function renderCardImg(p) {
  const emoji = getCatEmoji(p.c);
  // Usa img con onerror fallback a placeholder emoji
  return `<div class="prod-img-wrap">
    <span class="prod-img-placeholder">${emoji}</span>
  </div>`;
}

function render() {
  renderProg();
  renderSidebar();
  const s = STEPS[state.step];
  const c = document.getElementById('mainContent');
  if (!c) return;
  if (s.id === 'piattaforma') renderPf(c);
  else if (s.id === 'riepilogo') renderRiep(c);
  else renderProds(c, s.id);
}

function renderProg() {
  const el = document.getElementById('progressStrip');
  if (!el) return;
  el.innerHTML = STEPS.map((s,i) => {
    const cls = i < state.step ? 'done' : i === state.step ? 'active' : '';
    return `<div class="prog-step ${cls}" onclick="goToStep(${i})" title="${s.name}">
      <span class="prog-dot"></span>
      <span class="prog-label">${s.name}</span>
    </div>`;
  }).join('');
}

function renderSidebar() {
  const totalForn = Object.values(state.build)
    .filter(Boolean).reduce((s,p) => s + p.p, 0);
  const total = calcP(totalForn);
  const pieces = Object.values(state.build).filter(Boolean).length;

  const rows = Object.entries(BLD_LBL).map(([k,l]) => {
    const s = state.build[k];
    if (!s) return `<div class="sidebar-row empty"><span class="sr-cat">${l}</span><span class="sr-name">—</span></div>`;
    return `<div class="sidebar-row" onclick="goToStepById('${k}')" title="Modifica ${l}">
      <span class="sr-cat">${l}</span>
      <span class="sr-name">${trunc(s.d, 32)}</span>
      <span class="sr-price">${fmt(s.p)}</span>
    </div>`;
  }).join('');

  const sc = document.getElementById('stepCounter');
  if (sc) sc.textContent = `Step ${state.step+1} di ${STEPS.length}`;

  const sidebarBody = document.getElementById('sidebarBody');
  if (sidebarBody) sidebarBody.innerHTML = rows;

  const totalEl = document.getElementById('sidebarTotal');
  if (totalEl) totalEl.textContent = total > 0 ? fmt(totalForn) : '—';

  const rataEl = document.getElementById('sidebarRata');
  if (rataEl) rataEl.textContent = total > 0 ? `${fmtR(totalForn)}/mese × 36` : '';

  const piecesEl = document.getElementById('piecesCount');
  if (piecesEl) piecesEl.textContent = `${pieces}/9`;

  const btnCheckout = document.getElementById('btnCheckout');
  if (btnCheckout) btnCheckout.disabled = !(state.build.case && state.build.cpu && state.build.gpu);

  updateScalapayBar();
}

// ── RENDER PIATTAFORMA ────────────────────────────────────────
function renderPf(el) {
  const SOCKETS = {
    amd: {
      AM5:  {label:'AM5',  cpu:'Ryzen 7000 / 8000 / 9000', ddr:'DDR5 only',   note:'Piattaforma attuale — supportata fino al 2027', badge:'🔥 Consigliato'},
      AM4:  {label:'AM4',  cpu:'Ryzen 3000 / 5000',        ddr:'DDR4 only',   note:'Piattaforma matura, ottimo rapporto qualità/prezzo', badge:'💰 Budget'},
    },
    intel: {
      LGA1851: {label:'LGA1851', cpu:'Core Ultra 200 (15ᵃ gen)', ddr:'DDR5 only',   note:'Nuova piattaforma Intel, Arrow Lake', badge:'🔥 Consigliato'},
      LGA1700: {label:'LGA1700', cpu:'Core 12ᵃ / 13ᵃ / 14ᵃ gen', ddr:'DDR4 o DDR5', note:'Piattaforma collaudata, ampia scelta mobo', badge:'⚡ Popolare'},
      LGA1200: {label:'LGA1200', cpu:'Core 10ᵃ / 11ᵃ gen',        ddr:'DDR4 only',   note:'Piattaforma legacy, disponibilità limitata', badge:'📦 Legacy'},
    },
  };

  const pi = state.piattaforma;
  const sk = state.socket;

  const socketSection = pi ? `
    <div class="pf-socket-section">
      <div class="pf-socket-label">Scegli il socket:</div>
      <div class="pf-socket-grid">
        ${Object.entries(SOCKETS[pi]).map(([sock,info]) => `
          <button class="pf-socket-card ${sk===sock?'active':''}" onclick="selSocket('${sock}')">
            <div class="pf-socket-badge-label">${info.badge}</div>
            <div class="pf-socket-name">${info.label}</div>
            <div class="pf-socket-cpu">${info.cpu}</div>
            <div class="pf-socket-ddr">${info.ddr}</div>
            <div class="pf-socket-note">${info.note}</div>
          </button>
        `).join('')}
      </div>
    </div>
  ` : '<div class="pf-socket-hint">← Scegli prima AMD o Intel</div>';

  el.innerHTML = `
    <div class="step-header">
      <div class="step-eyebrow">step 01 — piattaforma e socket</div>
      <h1 class="step-title">SCEGLI LA<br><em>TUA</em> PIATTAFORMA<span class="acc">.</span></h1>
      <p class="step-desc">La piattaforma determina processore, scheda madre e tipo di RAM. Scegli brand e socket.</p>
    </div>
    <div class="pf-brand-row">
      <button class="pf-brand ${pi==='amd'?'active':''}"   onclick="selPf('amd')">
        <span class="pf-brand-name">AMD</span><span class="pf-brand-sub">Ryzen</span>
      </button>
      <button class="pf-brand ${pi==='intel'?'active':''}" onclick="selPf('intel')">
        <span class="pf-brand-name">INTEL</span><span class="pf-brand-sub">Core</span>
      </button>
    </div>
    ${socketSection}
    <button class="btn-next" ${!sk?'disabled':''} onclick="nextStep()">
      Continua con ${sk||'...'} <span class="arrow">→</span>
    </button>
  `;
}

// ── RENDER PRODOTTI ───────────────────────────────────────────
function renderProds(el, sid) {
  const allProds = getProds(sid);
  // SOTTOCATEGORIE: mostra selector solo se non c'è già una scelta attiva
  const active = state.subcat && state.subcat[sid];
  if (!active) {
    const scSel = SUBCATS && SUBCATS[sid] ? renderSubcatSelector(sid, allProds) : null;
    if (scSel) { el.innerHTML = scSel; return; }
  }
  if (active === '__all__' && state.subcat) state.subcat[sid] = null;

  const subFil = getSubcatProds ? getSubcatProds(sid, allProds) : allProds;
  const sc = SUBCATS && SUBCATS[sid];
  const backBtn = (sc && active && active !== '__all__')
    ? `<div class="subcat-back" onclick="clearSubcat('${sid}')">← ${sc.label}: <strong>${active}</strong> <span>— cambia</span></div>`
    : '';

  const step     = STEPS[state.step];
  const brands   = getBrands(sid);
  const ab       = state.filters[sid] || [];
  const sel      = state.build[sid];
  const q        = state.search[sid] || '';
  const tips     = getSmartTip(sid);

  // Prodotti incompatibili visibili ma grigi (max 30)
  const incompat = PRODS.filter(p => {
    if (p.c !== CAT[sid]) return false;
    if (allProds.find(x => x.k === p.k)) return false;
    return getIncompatReason(sid, p) !== null;
  }).slice(0, 30);

  const tipsHtml = tips.map(t =>
    `<div class="smart-tip"><span class="tip-icon">💡</span><span class="tip-text">${t}</span></div>`
  ).join('');

  const alertHtml = incompat.length > 0
    ? `<div class="compat-alert">⚠️ <strong>${incompat.length} prodotti non compatibili</strong> mostrati in grigio</div>`
    : '';

  const filterHtml = brands.length > 1 ? `
    <div class="filter-row">
      <button class="filter-chip ${ab.length===0?'active':''}" onclick="clearF('${sid}')">Tutti</button>
      ${brands.map(b => `<button class="filter-chip ${ab.includes(b)?'active':''}" onclick="togF('${sid}','${b}')">${b}</button>`).join('')}
    </div>` : '';

  const cards = [
    ...subFil.slice(0,120).map(p => renderCard(p, sid, sel, allProds, false)),
    ...incompat.map(p => renderCard(p, sid, sel, allProds, true)),
  ].join('');

  const emptyHtml = subFil.length === 0 && incompat.length === 0
    ? '<div class="empty-state"><h3>Nessun risultato</h3><p>Cambia i filtri o la ricerca.</p></div>'
    : '';

  const moreHtml = allProds.length > 120
    ? `<div class="more-hint">Mostrando 120 di ${allProds.length} — usa la ricerca per trovare prodotti specifici</div>`
    : '';

  el.innerHTML = `
    <div class="step-header">
      <div class="step-eyebrow">step ${String(state.step+1).padStart(2,'0')} — ${step.name.toLowerCase()}</div>
      <h1 class="step-title">${step.name.toUpperCase()}<span class="acc">.</span></h1>
      <p class="step-desc">${DESCS[sid]||''}</p>
    </div>
    ${backBtn}
    ${tipsHtml}
    ${filterHtml}
    <div class="search-row">
      <span class="search-icon">⌕</span>
      <input type="text" placeholder="Cerca nome, brand, codice…" value="${q}"
             oninput="setS('${sid}',this.value)">
    </div>
    <div class="products-count">${subFil.length} prodotti compatibili${ab.length||q?' (filtrati)':''}</div>
    ${alertHtml}
    ${sel ? `<button class="btn-next" onclick="nextStep()" style="margin-bottom:16px;margin-top:8px">Continua con ${trunc(sel.d,28)} <span class="arrow">→</span></button>` : ''}
    <div class="products-grid">${emptyHtml}${cards}${moreHtml}</div>
    ${sel ? `<button class="btn-next" onclick="nextStep()">Continua con ${trunc(sel.d,28)} <span class="arrow">→</span></button>` : ''}
    <button class="btn-skip" onclick="skipStep()">Salta questo componente →</button>
  `;
}

// ── RENDER CARD ───────────────────────────────────────────────
function renderCard(p, sid, sel, allProds, isIncompat) {
  const isSel  = sel && sel.k === p.k;
  const isOut  = p.stock === 0 && !p.incoming;
  const price  = calcP(p.p);
  const imgHtml = renderCardImg(p);

  let sCls = '', sLbl = '';
  if      (isOut)         { sCls = '';    sLbl = 'Esaurito'; }
  else if (p.stock === 99){ sCls = 'ok';  sLbl = 'Disponibile'; }
  else if (p.stock > 5)   { sCls = 'ok';  sLbl = `Disponibile · ${p.stock} pz`; }
  else if (p.stock > 0)   { sCls = 'low'; sLbl = `Ultime ${p.stock} unità`; }
  else if (p.incoming)    { sCls = 'inc'; sLbl = 'In arrivo'; }

  const badges    = isIncompat ? [] : getBadges(p, sid, allProds);
  const badgesHtml = badges.length
    ? `<div class="prod-badges">${badges.map(b => `<span class="prod-badge ${b.cls}">${b.label}</span>`).join('')}</div>`
    : '';

  const whyIncompat = isIncompat ? getIncompatReason(sid, p) : null;

  const socketBadge = p.socket
    ? `<div class="prod-socket-badge">${p.socket}${p.ddr?' · '+p.ddr:''}</div>` : '';

  const cls = ['prod-card', isSel?'selected':'', isOut?'unavailable':'', isIncompat?'incompatible':'']
    .filter(Boolean).join(' ');

  const onClick = isIncompat
    ? ''
    : isOut
      ? `onclick="showToast('Prodotto esaurito')"`
      : `onclick="handleCardClick(this)"`;

  const dataWhy = whyIncompat ? `data-why="${whyIncompat}"` : '';

  return `<div class="${cls}" ${dataWhy}
    data-k="${encodeURIComponent(p.k)}" data-sid="${sid}" ${onClick}>
    <div class="prod-check">${isSel ? '✓' : ''}</div>
    <div class="prod-img-wrap">
      <span class="prod-img-placeholder">${{'Case':'🖥️','CPU':'⚙️','GPU':'🎮','RAM':'💾','Scheda Madre':'🔌','SSD':'💿','PSU':'⚡','Dissipatore':'❄️','Extra':'🎁'}[p.c]||'📦'}</span>
    </div>
    <div class="prod-body">
    <div class="prod-brand">${p.b || p.s}</div>
    <div class="prod-name">${p.d}</div>
    ${socketBadge}
    ${badgesHtml}
    <div class="prod-price"><small>IVA incl.</small>${fmt(p.p)}</div>
    <div class="prod-rata">Scalapay: ${fmtR(p.p)}</div>
    <div class="prod-stock ${sCls}">${sLbl}</div>
  </div></div>`;
}

// ── RENDER RIEPILOGO ──────────────────────────────────────────
function renderRiep(el) {
  const totalForn = Object.values(state.build)
    .filter(Boolean).reduce((s,p) => s + p.p, 0);
  const totalComp = calcP(totalForn); // totale componenti IVA
  const total = calcTotale(totalComp); // + implementazione 30%
  const rata36 = total / 36;

  const rows = Object.entries(BLD_LBL).map(([k,l]) => {
    const s = state.build[k];
    if (!s) return '';
    return `<div class="recap-row" onclick="goToStepById('${k}')" title="Clicca per modificare">
      <div class="recap-cat">${l}</div>
      <div class="recap-name">${s.d}</div>
      <div class="recap-price">${fmt(s.p)} <span class="recap-edit">✏️</span></div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="step-header">
      <div class="step-eyebrow">step 11 — riepilogo</div>
      <h1 class="step-title">LA TUA<br><em>BUILD</em><span class="acc">.</span></h1>
      <p class="step-desc">Clicca su un componente per modificarlo. Quando sei pronto, procedi all'ordine.</p>
    </div>
    <div class="recap-list">${rows}</div>
    <div class="recap-total">
      <div class="recap-subtotal-row">
        <span class="recap-subtotal-lbl">Componenti IVA inclusa</span>
        <span class="recap-subtotal-val">${'€ '+totalComp.toFixed(2).replace('.',',')}</span>
      </div>
      <div class="recap-subtotal-row recap-impl">
        <span class="recap-subtotal-lbl">Costo implementazione <small>(montaggio, test, configurazione)</small></span>
        <span class="recap-subtotal-val">${'€ '+impl.toFixed(2).replace('.',',')}</span>
      </div>
      <div class="recap-total-divider"></div>
      <div class="recap-total-label">Totale finale IVA inclusa</div>
      <div class="recap-total-price">${'€ '+total.toFixed(2).replace('.',',')}</div>
      <div class="recap-total-rata">Scalapay: ${'€ '+rata36.toFixed(2).replace('.',',')} / mese × 36 rate a interessi zero</div>
    </div>
    <div class="recap-actions">
      <button class="btn-next" onclick="openCheckout()">
        Procedi all'ordine <span class="arrow">→</span>
      </button>
      <button class="btn-share" onclick="shareLink()">
        🔗 Condividi build
      </button>
    </div>
    <p class="recap-note">💳 Scalapay disponibile al checkout · 🚚 Spedizione BRT €24,90 · 🔧 Montaggio e test inclusi</p>
  `;
}

// ── AZIONI ────────────────────────────────────────────────────
function selPf(p) {
  state.piattaforma = p;
  state.socket      = null;
  state.build       = {case:null,cpu:null,mobo:null,ram:null,gpu:null,ssd:null,psu:null,cooler:null,ventole:null};
  render();
  requestAnimationFrame(() => {
    const row = document.querySelector('.pf-socket-section');
    if (row) row.scrollIntoView({behavior:'smooth', block:'center'});
  });
}

function selSocket(s) {
  state.socket = s;
  state.build  = {case:null,cpu:null,mobo:null,ram:null,gpu:null,ssd:null,psu:null,cooler:null,ventole:null};
  render();
  scrollToNext();
}

function handleCardClick(el) {
  const sid  = el.dataset.sid;
  const k    = decodeURIComponent(el.dataset.k);
  const prod = PRODS.find(p => p.k === k);
  if (!prod) return;
  if (prod.stock === 0 && !prod.incoming) { showToast('Prodotto esaurito'); return; }
  selProd(sid, prod);
}

function selProd(sid, prod) {
  if (!prod) return;
  const was = state.build[sid];
  // Toggle
  if (was && was.k === prod.k) {
    state.build[sid] = null;
    showToast('Rimosso dalla build');
  } else {
    state.build[sid] = prod;
    // Reset downstream se cambio mobo
    if (sid === 'mobo') { state.build.ram = null; state.build.case = null; }
    showToast(trunc(prod.d, 38) + ' aggiunto');
  }
  renderSidebar();
  render();
  if (state.build[sid]) scrollToNext();
}

function nextStep()       { if (state.step < STEPS.length-1) { state.step++; render(); scrollToTop(); } }
function skipStep()       { state.build[STEPS[state.step].id] = null; nextStep(); }
function goToStep(i)      { if (i > state.step) { showToast('Completa prima gli step precedenti'); return; } state.step = i; render(); }
function goToStepById(sid){ const i = STEPS.findIndex(s => s.id === sid); if (i >= 0) { state.step = i; render(); scrollToTop(); } }
function togF(sid, b)     { if (!state.filters[sid]) state.filters[sid] = []; const i = state.filters[sid].indexOf(b); i >= 0 ? state.filters[sid].splice(i,1) : state.filters[sid].push(b); render(); }
function clearF(sid)      { state.filters[sid] = []; render(); }
function setS(sid, v)     { state.search[sid] = v; render(); }

// ── CHECKOUT / WHATSAPP ───────────────────────────────────────
function openCheckout()  { document.getElementById('modalOverlay').classList.add('open'); }
function closeCheckout() { document.getElementById('modalOverlay').classList.remove('open'); }
function closeCheckoutIfOutside(e) { if (e.target.id === 'modalOverlay') closeCheckout(); }

function buildMsg(name, email, phone, note) {
  const totalForn = Object.values(state.build).filter(Boolean).reduce((s,p) => s+p.p, 0);
  const total     = calcP(totalForn);
  let msg = `🖥️ *CONFIGURAZIONE PC GAMING — Minimal Gamers*\n\n`;
  msg += `👤 *Cliente:* ${name}\n📧 ${email} · 📞 ${phone}\n\n`;
  msg += `*Componenti:*\n`;
  Object.entries(BLD_LBL).forEach(([k,l]) => {
    if (state.build[k]) msg += `• ${l}: ${state.build[k].d} — ${fmt(state.build[k].p)}\n`;
  });
  const msgTotComp = Object.values(state.build).filter(Boolean).reduce((s,p)=>s+calcP(p.p),0);
  const msgImpl = calcImpl(msgTotComp);
  const msgTot = calcTotale(msgTotComp);
  msg += `\n🔧 *Componenti IVA inclusa: ${'€ '+msgTotComp.toFixed(2).replace('.',',')}*\n`;
  msg += `⚙️ *Costo implementazione: ${'€ '+msgImpl.toFixed(2).replace('.',',')}*\n`;
  msg += `💰 *TOTALE: ${'€ '+msgTot.toFixed(2).replace('.',',')}*\n`;
  msg += `📦 Spedizione BRT: €24,90\n`;
  msg += `💳 Scalapay: ${'€ '+(msgTot/36).toFixed(2).replace('.',',')} × 36 rate\n`;
  if (note) msg += `\n📝 Note: ${note}\n`;
  return msg;
}

function submitOrder() {
  const name  = document.getElementById('ord-name')?.value  || '';
  const email = document.getElementById('ord-email')?.value || '';
  const phone = document.getElementById('ord-phone')?.value || '';
  const note  = document.getElementById('ord-note')?.value  || '';
  if (!name || !email || !phone) { showToast('Compila tutti i campi obbligatori'); return; }
  const msg = buildMsg(name, email, phone, note);
  const url = `https://wa.me/393477133866?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
  closeCheckout();
}

function shareLink() {
  const p = new URLSearchParams();
  if (state.piattaforma) p.set('pf', state.piattaforma);
  if (state.socket)      p.set('sk', state.socket);
  Object.entries(state.build).forEach(([k,v]) => { if (v) p.set(k, v.k); });
  const url = `${location.origin}${location.pathname}?${p.toString()}`;
  navigator.clipboard.writeText(url).then(() => showToast('Link copiato!'));
}

function loadFromURL() {
  const p = new URLSearchParams(location.search);
  if (p.get('pf')) state.piattaforma = p.get('pf');
  if (p.get('sk')) state.socket      = p.get('sk');
  ['case','cpu','mobo','ram','gpu','ssd','psu','cooler','ventole'].forEach(k => {
    const sku = p.get(k);
    if (sku) state.build[k] = PRODS.find(x => x.k === sku) || null;
  });
}

// ── INIT ─────────────────────────────────────────────────────
async 
// ════════════════════════════════════════════════════════════
// ASSISTENTE AI — Minimal Gamers PC Configurator
// Usa Claude API per consigliare componenti dal listino
// ════════════════════════════════════════════════════════════

const AI_MOLT = 1.22 * 1.35;

// Stato chat
const aiState = {
  open: false,
  messages: [],
  loading: false,
  build: {},      // componenti scelti dall'assistente
};

// Emoji per categoria
const CAT_EMOJI = {
  'CPU':'⚙️','GPU':'🎮','RAM':'💾','SSD':'💿',
  'Scheda Madre':'🔌','Case':'🖥️','PSU':'⚡','Dissipatore':'❄️'
};

// Suggerimenti iniziali
const AI_SUGGESTIONS = [
  '300fps su Warzone con budget 1500€',
  'PC gaming 4K under 3000€',
  'Build silenziosa per lavoro e gaming',
  'PC compatto ITX potente',
  'Miglior rapporto qualità/prezzo 2025',
];

function openAI() {
  document.getElementById('aiModal').classList.add('open');
  aiState.open = true;
  if(aiState.messages.length === 0) aiWelcome();
}
function closeAI() {
  document.getElementById('aiModal').classList.remove('open');
  aiState.open = false;
}

function aiWelcome() {
  aiAddMsg('bot', `Ciao! Sono l'assistente di <strong>Minimal Gamers</strong>. 
Dimmi cosa vuoi fare con il tuo PC e ti consiglio la build perfetta dal nostro catalogo. 
Puoi scrivere liberamente — tipo <em>"voglio 300fps su Warzone"</em> o <em>"ho 2000€ per un PC da gaming"</em>.`);
  renderAI();
}

function aiAddMsg(role, html, products) {
  aiState.messages.push({ role, html, products });
}

function aiRenderMessages() {
  const el = document.getElementById('aiMessages');
  if(!el) return;
  el.innerHTML = aiState.messages.map(m => {
    const label = m.role === 'bot' ? 'Assistente Minimal Gamers' : 'Tu';
    let prodsHtml = '';
    if(m.products && m.products.length) {
      prodsHtml = '<div class="ai-prod-cards">' + m.products.map(p => {
        const emoji = CAT_EMOJI[p.cat] || '📦';
        const added = aiState.build[p.cat]?.nome === p.nome;
        return `<div class="ai-prod-card ${added?'added':''}" onclick="aiAddToBuild(${JSON.stringify(p).replace(/"/g,'&quot;')})">
          <span class="ai-prod-card-emoji">${emoji}</span>
          <div class="ai-prod-card-body">
            <div class="ai-prod-card-name">${p.nome}</div>
            <div class="ai-prod-card-sub">${p.cat}${p.spec?' · '+p.spec:''}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
            <div class="ai-prod-card-price">€ ${p.prezzo.toFixed(2).replace('.',',')}</div>
            <div class="ai-prod-card-action">${added?'✓ Aggiunto':'+ Aggiungi'}</div>
          </div>
        </div>`;
      }).join('') + '</div>';
    }
    return `<div class="ai-msg ${m.role}">
      <div class="ai-msg-label">${label}</div>
      <div class="ai-bubble">${m.html}${prodsHtml}</div>
    </div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

function aiShowTyping() {
  const el = document.getElementById('aiMessages');
  if(!el) return;
  const typing = document.createElement('div');
  typing.id = 'aiTyping';
  typing.className = 'ai-msg bot';
  typing.innerHTML = '<div class="ai-msg-label">Assistente</div><div class="ai-bubble"><div class="ai-typing"><span></span><span></span><span></span></div></div>';
  el.appendChild(typing);
  el.scrollTop = el.scrollHeight;
}

function aiHideTyping() {
  document.getElementById('aiTyping')?.remove();
}

function aiAddToBuild(prod) {
  aiState.build[prod.cat] = prod;
  
  // Aggiungi anche alla build principale del configuratore
  const mainProd = PRODS.find(p => p.d === prod.nome || p.d.includes(prod.nome.substring(0,20)));
  if(mainProd) {
    const sidMap = {
      'CPU':'cpu','GPU':'gpu','RAM':'ram','SSD':'ssd',
      'Scheda Madre':'mobo','Case':'case','PSU':'psu','Dissipatore':'cooler'
    };
    const sid = sidMap[prod.cat];
    if(sid) {
      state.build[sid] = mainProd;
      renderSidebar();
      showToast(prod.nome.substring(0,35) + ' aggiunto alla build!');
    }
  }
  renderAI();
}

async function aiSend() {
  const input = document.getElementById('aiInput');
  const msg = input.value.trim();
  if(!msg || aiState.loading) return;
  
  input.value = '';
  aiAddMsg('user', msg);
  aiState.loading = true;
  renderAI();
  aiShowTyping();
  
  // Prepara il contesto prodotti (campione per non superare il context window)
  const prodCtx = {};
  const cats = ['CPU','GPU','RAM','SSD','Scheda Madre','PSU','Dissipatore','Case'];
  cats.forEach(cat => {
    const items = PRODS
      .filter(p => p.c === cat && (p.stock > 0 || p.incoming))
      .sort((a,b) => a.p - b.p)
      .slice(0, 25)
      .map(p => ({
        nome: p.d,
        prezzo: Math.round(p.p * AI_MOLT * 100) / 100,
        socket: p.socket || undefined,
        linea: p._linea || undefined,
        serie: p._serie || undefined,
        tipo: p._tipo || undefined,
        tipoCool: p._tipo_cool || undefined,
        watt: p._w || undefined,
      }));
    if(items.length) prodCtx[cat] = items;
  });

  // Build attuale
  const buildAttuale = Object.entries(aiState.build)
    .map(([cat,p]) => `${cat}: ${p.nome} (€${p.prezzo.toFixed(2)})`)
    .join(', ') || 'nessun componente ancora';

  // Cronologia messaggi
  const history = aiState.messages.slice(-6).map(m => ({
    role: m.role === 'bot' ? 'assistant' : 'user',
    content: m.html.replace(/<[^>]+>/g,'').substring(0,300)
  }));

  const systemPrompt = `Sei l'assistente AI di Minimal Gamers, negozio italiano di PC gaming. 
Aiuti i clienti a scegliere componenti PC ESCLUSIVAMENTE dal catalogo disponibile.

CATALOGO DISPONIBILE (prezzi IVA inclusa):
${JSON.stringify(prodCtx, null, 0)}

BUILD ATTUALE DEL CLIENTE: ${buildAttuale}

REGOLE FONDAMENTALI:
1. Consiglia SOLO prodotti presenti nel catalogo, con nome e prezzo ESATTI
2. I prezzi nel catalogo sono già IVA inclusa — non modificarli
3. Considera sempre la compatibilità: AM5 richiede DDR5, AM4 richiede DDR4
4. Se il cliente non capisce di hardware, spiega in modo semplice e amichevole
5. Per budget limitati (< 800€) scegli componenti entry/mid. Per budget alti scegli top di gamma
6. Consiglia sempre: CPU + Scheda Madre compatibili + RAM giusta + GPU adatta all'uso + SSD veloce + PSU adeguato
7. Per gaming a 300fps serve GPU potente, CPU veloce e RAM DDR5-6000+
8. Rispondi in italiano, in modo diretto e friendly

FORMATO RISPOSTA:
- Testo conversazionale breve (2-4 frasi)  
- Poi lista JSON dei prodotti consigliati in questo formato ESATTO:
PRODOTTI_JSON:[{"nome":"nome esatto dal catalogo","cat":"Categoria","prezzo":123.45,"spec":"spec breve"}]
- Se la domanda non riguarda hardware, rispondi normalmente senza JSON`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer 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'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1000,
        messages: [
          { role: 'system', content: systemPrompt },
          ...history,
          { role: 'user', content: msg }
        ]
      })
    });
    
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || 'Errore nella risposta.';
    
    // Estrai il testo e i prodotti JSON
    let botText = text;
    let products = [];
    
    const jsonMatch = text.match(/PRODOTTI_JSON:(\[.*?\])/s);
    if(jsonMatch) {
      try {
        products = JSON.parse(jsonMatch[1]);
        botText = text.replace(/PRODOTTI_JSON:.*$/s, '').trim();
      } catch(e) {}
    }
    
    // Formatta il testo
    botText = botText
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
    
    aiHideTyping();
    aiAddMsg('bot', botText, products);
  } catch(e) {
    aiHideTyping();
    aiAddMsg('bot', 'Errore di connessione. Riprova tra qualche secondo.');
  }
  
  aiState.loading = false;
  renderAI();
}

function aiUseSuggestion(text) {
  document.getElementById('aiInput').value = text;
  aiSend();
}

function renderAI() {
  aiRenderMessages();
  const send = document.getElementById('aiSend');
  if(send) send.disabled = aiState.loading;
}

async function init() {
  // Mostra loading mentre carica i prodotti
  const mc = document.getElementById('mainContent');
  if(mc) mc.innerHTML = '<div style="padding:60px 40px;text-align:center;font-family:var(--mono);font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--ink4)">Caricamento prodotti in corso...</div>';
  
  await fetchProdotti();
  loadFromURL();
  const cnt = document.getElementById('top-count');
  if (cnt) cnt.textContent = PRODS.length.toLocaleString('it-IT') + ' prodotti live';
  render();
}
init();