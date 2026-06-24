// ════════════════════════════════════════════════════════════════════
// BACKEND — Crea PC custom su Shopify — Minimal Gamers
// Endpoint serverless Vercel: POST /api/crea-pc
//
// Flusso:
//   1. Riceve { build, nomePc, prezzo } dal configuratore
//   2. Ottiene access token via client_credentials (ID+Secret)
//   3. Genera HTML descrizione (modulo genera-descrizione.js)
//   4. Crea prodotto ACTIVE su Shopify con productCreate
//   5. Lo pubblica SOLO via link (unlisted): niente ricerca/collezioni
//   6. Restituisce { url } = link diretto al prodotto
//
// VARIABILI D'AMBIENTE richieste su Vercel (NON nel codice!):
//   SHOPIFY_CLIENT_ID      = 5be99b610d9735d313e27eb954e49133
//   SHOPIFY_CLIENT_SECRET  = shpss_xxxxx (quello NUOVO dopo la rotazione)
//   SHOPIFY_SHOP           = minimalgamers
// ════════════════════════════════════════════════════════════════════

// generaDescrizioneHtml è definita più sotto in questo stesso file (incorporata)

const API_VERSION = '2026-04';

// ─── Cache del token in memoria (vive finché la funzione resta "calda") ───
let _tokenCache = { token: null, expiresAt: 0 };

async function getAccessToken(shop, clientId, clientSecret){
  // Riusa il token se ancora valido (con margine di 5 min)
  const now = Date.now();
  if(_tokenCache.token && now < _tokenCache.expiresAt - 300000){
    return _tokenCache.token;
  }
  const res = await fetch(`https://${shop}.myshopify.com/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if(!res.ok){
    const txt = await res.text();
    throw new Error(`Token error ${res.status}: ${txt}`);
  }
  const data = await res.json();
  _tokenCache = {
    token: data.access_token,
    expiresAt: now + (data.expires_in || 86399) * 1000,
  };
  return data.access_token;
}

// ─── Salva un lead nel database Supabase (non bloccante) ───
async function salvaLeadSupabase(lead){
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
  // Se Supabase non è configurato, salta silenziosamente
  if(!SUPABASE_URL || !SUPABASE_SECRET) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/lead_configuratore`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SECRET,
        'Authorization': `Bearer ${SUPABASE_SECRET}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(lead),
    });
    if(!res.ok){
      const txt = await res.text();
      console.error('Supabase save error', res.status, txt);
      return false;
    }
    return true;
  } catch(e){
    console.error('Supabase exception (non bloccante):', String(e.message || e));
    return false;
  }
}

// ─── Chiamata GraphQL Admin generica ───
async function shopifyGraphQL(shop, token, query, variables){
  const res = await fetch(`https://${shop}.myshopify.com/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if(data.errors){
    throw new Error('GraphQL: ' + JSON.stringify(data.errors));
  }
  return data.data;
}

// ─── Handler principale ───

// ═══ GENERATORE DESCRIZIONE (incorporato) ═══
// ════════════════════════════════════════════════════════════════════
// GENERATORE DESCRIZIONE HTML PRODOTTO — Minimal Gamers (versione JS)
// Porting fedele del generatore Python. Tema light + gradient magenta/viola,
// FPS gradient stile STRIKE, icone SVG inline, recensioni a carosello.
// ════════════════════════════════════════════════════════════════════

const LOGO_URL = "https://www.minimalgamers.it/cdn/shop/files/minimal_gamers.png?v=1664907123&width=400";

const INLINE_CSS = `
.mg-wrap{--mg-grad:linear-gradient(135deg,#ff0099,#8b00ff);font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1f29;background:#ffffff;max-width:1100px;margin:0 auto;padding:0;line-height:1.6;box-sizing:border-box;border-radius:16px;overflow:hidden}
.mg-wrap *{box-sizing:border-box}
.mg-hs{background:#fff;padding:60px 24px 40px;text-align:center;position:relative}
.mg-hs::before{content:"";position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#ff0099,#8b00ff)}
.mg-logo{width:180px;height:auto;margin-bottom:24px;opacity:.95}
.mg-h1{font-size:56px;font-weight:900;line-height:1;margin:0 0 16px;letter-spacing:-1px}
.mg-h1 .mg-tg{color:#1a1f29;font-size:28px;letter-spacing:4px;font-weight:600}
.mg-h1 .mg-td{background:var(--mg-grad);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;font-size:64px}
.mg-h2{font-size:22px;font-weight:700;background:var(--mg-grad);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;margin:0 0 28px}
.mg-hd{max-width:760px;margin:0 auto 32px}
.mg-hd p{font-size:16px;color:#4b5563;line-height:1.8}
.mg-bb{max-width:760px;margin:0 auto}
.mg-bc{background:#fff;border:1px solid rgba(0,0,0,.08);box-shadow:0 2px 8px rgba(0,0,0,.04);border-radius:14px;padding:20px 24px}
.mg-b1{font-size:18px;font-weight:800;background:var(--mg-grad);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:1px}
.mg-b2{font-size:14px;color:#6b7280;margin:4px 0}
.mg-bs{font-size:12px;font-weight:600;background:var(--mg-grad);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:1px}
.mg-bx{margin-top:16px}
.mg-bn{background:linear-gradient(135deg,rgba(255,0,153,.06),rgba(139,0,255,.06));border:1px solid rgba(155,31,255,.2);border-radius:10px;padding:14px 18px;margin-bottom:16px}
.mg-n1{font-size:14px;font-weight:800;background:var(--mg-grad);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;margin:0 0 6px}
.mg-n2{font-size:13px;color:#6b7280;margin:0;line-height:1.6}
.mg-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid rgba(0,0,0,.06);border-radius:12px;overflow:hidden}
.mg-table thead th{background:#fff;color:#1a1f29;font-size:13px;font-weight:800;letter-spacing:1px;padding:14px 12px;text-align:center}
.mg-table thead th:first-child{text-align:left}
.mg-table tbody td{padding:12px;border-top:1px solid rgba(0,0,0,.06)}
.mg-gn{font-weight:700;font-size:14px;color:#1a1f29}
.mg-tc{text-align:center}
.mg-fb{display:inline-block;color:#fff;font-weight:700;padding:7px 16px;border-radius:10px;font-size:13px;box-shadow:0 2px 6px rgba(0,0,0,.12)}
.mg-f1080{background:linear-gradient(135deg,#5ec8f0,#3b9fe0)}
.mg-f1440{background:linear-gradient(135deg,#a855f7,#7c3aed)}
.mg-f4k{background:linear-gradient(135deg,#ec4899,#d6336c)}
.mg-ss{padding:60px 24px;background:#fafbfc}
.mg-sk{max-width:900px;margin:0 auto}
.mg-sh,.mg-rh{text-align:center;margin-bottom:40px}
.mg-s1{font-size:38px;font-weight:900;margin:0 0 12px;letter-spacing:-.5px}
.mg-sg{color:#1a1f29}
.mg-sd{background:var(--mg-grad);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.mg-s2{font-size:16px;color:#6b7280;max-width:600px;margin:0 auto}
.mg-sx{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
.mg-sr{display:flex;align-items:center;gap:16px;background:#fff;border:1px solid rgba(0,0,0,.08);box-shadow:0 1px 3px rgba(0,0,0,.04);border-radius:12px;padding:18px 20px;transition:all .2s}
.mg-sr:hover{border-color:transparent;background:linear-gradient(#fff,#fff) padding-box,var(--mg-grad) border-box;box-shadow:0 4px 16px rgba(155,31,255,.18)}
.mg-sc{flex-shrink:0;width:52px;height:52px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,rgba(255,0,153,.12),rgba(139,0,255,.12));border-radius:10px}
.mg-si{width:32px;height:32px;object-fit:contain}
.mg-svg{width:30px;height:30px;color:#c800d6}
.mg-sn{font-size:12px;font-weight:800;background:var(--mg-grad);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:.5px;text-transform:uppercase}
.mg-se{font-size:14px;color:#1a1f29;margin:4px 0 0;font-weight:500;line-height:1.4}
.mg-rs{padding:60px 24px;background:#fff}
.mg-rx{max-width:1000px;margin:0 auto;position:relative;padding:0 48px}
.mg-rw{overflow:hidden}
.mg-rl{display:flex;gap:16px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;-ms-overflow-style:none;padding:4px}
.mg-rl::-webkit-scrollbar{display:none}
.mg-rc{flex:0 0 calc(33.333% - 11px);min-width:260px;scroll-snap-align:start}
.mg-rt{background:#fff;border:1px solid rgba(0,0,0,.08);box-shadow:0 2px 8px rgba(0,0,0,.04);border-radius:14px;padding:24px;height:100%}
.mg-rv{font-size:16px;margin-bottom:12px}
.mg-re{font-size:14px;color:#374151;font-style:italic;line-height:1.6;margin:0 0 12px}
.mg-ra{font-size:13px;font-weight:700;background:var(--mg-grad);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.mg-sb{position:absolute;top:50%;transform:translateY(-50%);width:40px;height:40px;border-radius:50%;border:1px solid rgba(0,0,0,.1);background:#fff;color:#8b00ff;font-size:24px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2;transition:all .2s;padding:0}
.mg-sb:hover{border-color:#ff0099;color:#ff0099;box-shadow:0 2px 10px rgba(255,0,153,.2)}
.mg-lt{left:0}
.mg-rg{right:0}
@media (max-width:768px){.mg-h1 .mg-td{font-size:44px}.mg-h1 .mg-tg{font-size:22px}.mg-s1{font-size:28px}.mg-sx{grid-template-columns:1fr}.mg-rc{flex:0 0 100%}.mg-hs{padding:40px 16px 30px}.mg-rx{padding:0 40px}}
`;

const SVG_ICONS = {
  cpu: `<svg class="mg-si mg-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5" rx=".5"/><path d="M9 2v2M12 2v2M15 2v2M9 20v2M12 20v2M15 20v2M2 9h2M2 12h2M2 15h2M20 9h2M20 12h2M20 15h2"/></svg>`,
  gpu: `<svg class="mg-si mg-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="8" cy="12" r="2.5"/><circle cx="15.5" cy="12" r="2.5"/><path d="M2 18v3"/></svg>`,
  ram: `<svg class="mg-si mg-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8h20v8H2z"/><path d="M6 8v8M10 8v8M14 8v8M18 8v8M2 16v2M22 16v2"/></svg>`,
  ssd: `<svg class="mg-si mg-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h6M7 13h10M7 17h4"/><circle cx="17" cy="9" r="1"/></svg>`,
  mobo: `<svg class="mg-si mg-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="6" y="6" width="5" height="5" rx=".5"/><path d="M14 7h4M14 10h4M7 15h10M7 18h6"/><circle cx="16" cy="16" r=".6"/></svg>`,
  cooler: `<svg class="mg-si mg-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M12 10c0-3 1-5 0-7M14 12c3 0 5 1 7 0M12 14c0 3-1 5 0 7M10 12c-3 0-5-1-7 0"/></svg>`,
  psu: `<svg class="mg-si mg-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="12" r="3.5"/><circle cx="9" cy="12" r=".5"/><path d="M16 10h3M16 13h3M16 16h2"/></svg>`,
  os: `<svg class="mg-si mg-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12l8-1.2V4L3 5.2zM13 10.6L21 9.5V3l-8 1.2zM3 13l8 1.2V20l-8-1.2zM13 14.2l8 1.3V21l-8-1.2z"/></svg>`,
  monitor: `<svg class="mg-si mg-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`,
  mouse: `<svg class="mg-si mg-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12 6v4"/></svg>`,
  keyboard: `<svg class="mg-si mg-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M9 13h6"/></svg>`,
  headset: `<svg class="mg-si mg-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="2" y="14" width="4" height="6" rx="1.5"/><rect x="18" y="14" width="4" height="6" rx="1.5"/><path d="M20 20a3 3 0 0 1-3 3h-2"/></svg>`
};

const GIOCHI = ['Warzone','Fortnite','GTA 6','Cyberpunk 2077','Battlefield 6','FC 26','Call of Duty','Apex Legends','Valorant','Counter-Strike 2'];

const TEMPLATES_DESC = [
  "Scopri il potere indomito del PC Gaming {nome}, la tua porta d'accesso a prestazioni straordinarie e gaming senza compromessi! Equipaggiato con il potente {cpu}, {nome} ti garantisce velocità e reattività senza pari su titoli come {gioco1} e {gioco2}. La scheda grafica {gpu} porta i tuoi giochi a un livello di realismo mai visto, con frame rate fluidi che ti immergeranno completamente nell'azione. Con {ram} di memoria potrai gestire i giochi più esigenti e lo streaming senza alcun rallentamento. Grazie al veloce {ssd}, i tempi di caricamento saranno un ricordo del passato. Scegli {nome} e preparati a dominare!",
  "Benvenuto nel futuro del gaming con {nome}, una macchina costruita per chi non accetta compromessi. Il cuore pulsante è il {cpu}, capace di divorare qualsiasi sfida tu gli ponga davanti, da {gioco1} alle sessioni più intense di {gioco2}. La {gpu} dipinge ogni frame con una nitidezza cristallina, regalandoti un vantaggio competitivo in ogni partita. I {ram} di RAM assicurano un multitasking impeccabile, mentre il {ssd} azzera le attese. {nome} non è solo un PC: è la tua arma definitiva.",
  "Preparati a ridefinire i tuoi limiti con {nome}. Questa configurazione monta il formidabile {cpu}, un processore che trasforma ogni millisecondo in un vantaggio su {gioco1}, {gioco2} e qualsiasi titolo tu voglia conquistare. La potenza grafica della {gpu} ti immerge in mondi dettagliati con fluidità assoluta. Con {ram} di memoria e un {ssd} ultraveloce, {nome} elimina ogni collo di bottiglia tra te e la vittoria. Il dominio inizia adesso.",
  "{nome} è la risposta a chi cerca prestazioni senza confini. Con il {cpu} a guidare le operazioni, ogni sessione di gioco diventa pura adrenalina: {gioco1} e {gioco2} non avranno più segreti. La scheda video {gpu} sprigiona una potenza grafica capace di farti vivere ogni dettaglio come fossi dentro il gioco. I {ram} di RAM e lo storage {ssd} completano un sistema pensato per non farti mai aspettare. Entra nell'arena con {nome}.",
  "C'è una nuova leggenda nel mondo del gaming, e si chiama {nome}. Alimentato dal {cpu}, questo PC affronta {gioco1}, {gioco2} e i titoli più impegnativi con una disinvoltura disarmante. La {gpu} regala immagini mozzafiato e una fluidità che ti farà dimenticare cosa significa 'lag'. Grazie a {ram} di memoria e al rapidissimo {ssd}, tutto è istantaneo. {nome} non scende a compromessi, e nemmeno tu dovresti.",
  "Domina ogni campo di battaglia con {nome}, il PC gaming progettato per i veri campioni. Il {cpu} garantisce una potenza di calcolo che ti permette di eccellere in {gioco1} e {gioco2} senza il minimo tentennamento. La {gpu} trasforma la grafica in spettacolo puro, con frame rate che ti danno il vantaggio decisivo. {ram} di RAM per il multitasking più spinto e un {ssd} che carica tutto in un lampo. Con {nome}, la vittoria è una questione di abitudine.",
  "Sblocca il tuo pieno potenziale con {nome}. Questa build è costruita attorno al {cpu}, un processore che ti dà la reattività necessaria per primeggiare su {gioco1}, {gioco2} e oltre. La {gpu} porta in scena una qualità visiva impressionante unita a prestazioni fluidissime. Con {ram} di memoria gestisci gioco, stream e chat senza un singolo intoppo, mentre il {ssd} rende i caricamenti invisibili. {nome}: potenza che si sente in ogni click.",
  "{nome} nasce per chi vive il gaming come una vera passione. Il motore è il {cpu}, capace di spingere {gioco1} e {gioco2} ai massimi livelli senza esitazioni. La scheda grafica {gpu} ti regala un colpo d'occhio spettacolare e una fluidità che fa la differenza nei momenti decisivi. {ram} di RAM e un {ssd} fulmineo assicurano che il tuo sistema sia sempre un passo avanti. Scegli {nome} e gioca senza limiti."
];

const PERIF_PHRASES = {
  monitor:  "Il tutto sublimato dal monitor {v}, per immagini che esaltano ogni frame.",
  mouse:    "Con il mouse {v} avrai una precisione chirurgica in ogni mira.",
  keyboard: "La tastiera {v} ti dà la reattività necessaria per non perdere un colpo.",
  headset:  "E grazie alle cuffie {v}, ogni passo del nemico sarà tradito dal suono."
};

const RECENSIONI_POOL = [
  ["Semplicemente fantastico! Il raffreddamento è silenzioso e le luci RGB sono bellissime.","Marco"],
  ["Il processore ha prestazioni incredibili, riesco a fare tutto senza problemi!","Francesco"],
  ["La scheda video gestisce ogni gioco al massimo dei dettagli, sogni avverati!","Chiara"],
  ["L'SSD è velocissimo, carica i giochi in un attimo. Non potrei chiedere di più!","Lorenzo"],
  ["Design elegante che si adatta perfettamente alla mia stanza!","Anna"],
  ["La RAM è super reattiva, multitasking senza lag!","Silvia"],
  ["Grande qualità-prezzo! Ottime prestazioni a un costo ragionevole.","Pierre"],
  ["Il raffreddamento gestisce bene anche le sessioni più lunghe, mai troppo caldo.","Sophie"],
  ["Ho adorato le luci RGB, danno un'atmosfera spettacolare al mio setup!","Hans"],
  ["Qualità costruttiva eccellente, solidità e design accattivante.","Klaus"],
  ["Un sogno per ogni gamer! Prestazioni eccezionali, mai visto nulla di simile.","Petra"],
  ["Gioco a titoli pesanti e non ho mai avuto cali di frame. Fantastico!","John"],
  ["Un PC che offre tutto ciò che promette e anche di più. Consigliato!","Sarah"],
  ["Le prestazioni sono imbattibili e la silenziosità è un bonus incredibile!","Carlos"],
  ["Incredibile come gestisce il multitasking. Non torno più indietro!","Luca"],
  ["Montaggio impeccabile, cavi ordinatissimi. Si vede la cura nei dettagli.","Giulia"],
  ["Acceso e funzionante in 5 minuti. Windows già pronto, zero pensieri.","Davide"],
  ["Spedizione velocissima e imballaggio super protettivo. Top.","Martina"],
  ["Temperatura sempre sotto controllo anche dopo ore di gioco intenso.","Andrea"],
  ["Finalmente gioco in 1440p senza compromessi. Una bestia.","Simone"]
];

// ─── Hash deterministico (sostituisce md5 di Python con un hash semplice) ───
function seedFromName(nome){
  const s = (nome||'').toLowerCase().trim();
  let h = 2166136261;
  for(let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0);
}
// PRNG deterministico (mulberry32)
function mulberry32(seed){
  return function(){
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function pickN(arr, n, rnd){
  const copy = arr.slice();
  const out = [];
  for(let i=0;i<n && copy.length;i++){
    const idx = Math.floor(rnd()*copy.length);
    out.push(copy.splice(idx,1)[0]);
  }
  return out;
}
function escapeHtml(s){
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function cleanNome(nome, maxLen){
  maxLen = maxLen || 70;
  if(!nome) return '';
  nome = String(nome).replace(/\s+/g,' ').trim();
  if(nome.length > maxLen){
    nome = nome.slice(0, maxLen).replace(/\s\S*$/,'') + '…';
  }
  return escapeHtml(nome);
}

function stimaFps(gpuNome){
  const gpu = (gpuNome||'').toLowerCase();
  let base;
  if(/5090|4090/.test(gpu)) base = 1.7;
  else if(/5080|4080/.test(gpu)) base = 1.4;
  else if(/5070 ti|4070 ti/.test(gpu)) base = 1.2;
  else if(/5070|4070/.test(gpu)) base = 1.0;
  else if(/5060 ti|4060 ti/.test(gpu)) base = 0.82;
  else if(/5060|4060/.test(gpu)) base = 0.70;
  else if(/5050|4050|3050/.test(gpu)) base = 0.52;
  else base = 0.75;
  const ref = {'Warzone':320,'Fortnite':400,'GTA 6':140,'Cyberpunk 2077':180,'Battlefield 6':350,'FC 26':380};
  const out = {};
  for(const g in ref){
    const f1080 = Math.floor(ref[g]*base);
    out[g] = {'1080p':f1080,'1440p':Math.floor(f1080*0.72),'4k':Math.floor(f1080*0.48)};
  }
  return out;
}

function generaDescrizioneHtml(build, nomePc){
  const nome = (nomePc||'CUSTOM').trim().toUpperCase();
  const seed = seedFromName(nome);
  const rnd = mulberry32(seed);

  const cpu = cleanNome(build.cpu||'CPU Gaming');
  const gpu = cleanNome(build.gpu||'GPU Gaming');
  const ram = cleanNome(build.ram||'16GB', 40);
  const ssd = cleanNome(build.ssd||'SSD NVMe', 40);

  // Nome in Title Case per i template
  const nomeTitle = nome.split(' ').map(w=>w.charAt(0)+w.slice(1).toLowerCase()).join(' ');

  // 1. Descrizione
  let template = TEMPLATES_DESC[seed % TEMPLATES_DESC.length];
  const giochi = pickN(GIOCHI, 2, mulberry32(seed));
  let desc = template
    .replace(/{nome}/g, escapeHtml(nomeTitle))
    .replace(/{cpu}/g, cpu).replace(/{gpu}/g, gpu)
    .replace(/{ram}/g, ram).replace(/{ssd}/g, ssd)
    .replace(/{gioco1}/g, giochi[0]).replace(/{gioco2}/g, giochi[1]);
  const perifKeys = ['monitor','mouse','keyboard','headset'];
  const extra = [];
  for(const pk of perifKeys){
    if(build[pk]){ extra.push(PERIF_PHRASES[pk].replace('{v}', cleanNome(build[pk],45))); }
  }
  if(extra.length) desc += ' ' + extra.join(' ');

  // 2. Benchmark
  const fps = stimaFps(gpu);
  let rows = '';
  for(const g in fps){
    rows += `
            <tr>
              <td class="mg-gn">${escapeHtml(g.toUpperCase())}</td>
              <td class="mg-tc"><span class="mg-fb mg-f1080">${fps[g]['1080p']} FPS</span></td>
              <td class="mg-tc"><span class="mg-fb mg-f1440">${fps[g]['1440p']} FPS</span></td>
              <td class="mg-tc"><span class="mg-fb mg-f4k">${fps[g]['4k']} FPS</span></td>
            </tr>`;
  }

  // 3. Specifiche
  const specOrder = [['cpu','Processore'],['gpu','Scheda Grafica'],['ram','Memoria RAM'],['ssd','Memoria SSD'],['mobo','Scheda Madre'],['cooler','Raffreddamento'],['psu','Alimentatore'],['os','Sistema Operativo'],['monitor','Monitor'],['mouse','Mouse'],['keyboard','Tastiera'],['headset','Cuffie']];
  let specs = '';
  for(const [key,label] of specOrder){
    const val = build[key];
    if(!val) continue;
    const icon = SVG_ICONS[key] || SVG_ICONS['os'];
    specs += `
          <div class="mg-sr">
            <div class="mg-sc">${icon}</div>
            <div>
              <div class="mg-sn">${escapeHtml(label)}</div>
              <p class="mg-se">${cleanNome(val,90)}</p>
            </div>
          </div>`;
  }

  // 4. Recensioni
  const reviews = pickN(RECENSIONI_POOL, 12, rnd);
  let revCards = '';
  for(const [testo,autore] of reviews){
    revCards += `
            <div class="mg-rc">
              <div class="mg-rt">
                <div class="mg-rv"><span>⭐</span><span>⭐</span><span>⭐</span><span>⭐</span><span>⭐</span></div>
                <p class="mg-re">"${escapeHtml(testo)}"</p>
                <div class="mg-ra">- ${escapeHtml(autore)}</div>
              </div>
            </div>`;
  }

  return `<style>${INLINE_CSS}</style>
<div class="mg-wrap" id="mg-pc-description">
  <section class="mg-hs">
    <img class="mg-logo" alt="Minimal Gamers" src="${LOGO_URL}">
    <h1 class="mg-h1"><span class="mg-tg">PC GAMING</span><br><span class="mg-td">${escapeHtml(nome)}</span></h1>
    <h2 class="mg-h2">Potenza su misura, costruita per te.</h2>
    <div class="mg-hd"><p>${desc}</p></div>
    <div class="mg-bb">
      <div class="mg-bc">
        <div class="mg-b1">BENCHMARK GAMING</div>
        <div class="mg-b2">Stime FPS nei giochi più popolari</div>
        <div class="mg-bs">1080p • 1440p • 4K</div>
      </div>
      <div class="mg-bx">
        <div class="mg-bn">
          <p class="mg-n1">⚡ VALORI INDICATIVI</p>
          <p class="mg-n2">Gli FPS mostrati sono <strong>stime indicative</strong> basate sulla fascia di componenti e possono variare in base a driver, gioco, impostazioni e aggiornamenti.</p>
        </div>
        <table class="mg-table">
          <thead><tr><th>GIOCO</th><th>1080P</th><th>1440P</th><th>4K</th></tr></thead>
          <tbody>${rows}
          </tbody>
        </table>
      </div>
    </div>
  </section>
  <section class="mg-ss">
    <div class="mg-sk">
      <div class="mg-sh">
        <h2 class="mg-s1"><span class="mg-sg">SPECIFICHE</span> <span class="mg-sd">TECNICHE</span></h2>
        <p class="mg-s2">Ogni componente è stato selezionato per garantirti la vittoria. Niente compromessi, solo pura potenza.</p>
      </div>
      <div class="mg-sx">${specs}
      </div>
    </div>
  </section>
  <section class="mg-rs">
    <div class="mg-sk">
      <div class="mg-rh">
        <h2 class="mg-s1"><span class="mg-sg">COSA DICONO I NOSTRI</span> <span class="mg-sd">CLIENTI</span></h2>
        <p class="mg-s2">Le parole di chi ha già scelto la potenza e l'affidabilità dei nostri PC.</p>
      </div>
    </div>
    <div class="mg-rx">
      <button class="mg-sb mg-lt" aria-label="Recensione precedente" onclick="mgSlide(this,-1)">‹</button>
      <div class="mg-rw">
        <div class="mg-rl" id="mgReviews">${revCards}
        </div>
      </div>
      <button class="mg-sb mg-rg" aria-label="Recensione successiva" onclick="mgSlide(this,1)">›</button>
    </div>
  </section>
</div>
<script>
(function(){
  function mgSlide(btn, dir){
    var wrap = btn.closest('.mg-rx');
    var track = wrap.querySelector('.mg-rl');
    var card = track.querySelector('.mg-rc');
    if(!card) return;
    var step = card.offsetWidth + 16;
    track.scrollBy({left: dir*step, behavior:'smooth'});
  }
  window.mgSlide = mgSlide;
  document.querySelectorAll('.mg-rx').forEach(function(wrap){
    var track = wrap.querySelector('.mg-rl');
    var paused = false;
    wrap.addEventListener('mouseenter', function(){paused=true;});
    wrap.addEventListener('mouseleave', function(){paused=false;});
    setInterval(function(){
      if(paused) return;
      var card = track.querySelector('.mg-rc');
      if(!card) return;
      var step = card.offsetWidth + 16;
      if(track.scrollLeft + track.clientWidth >= track.scrollWidth - 5){
        track.scrollTo({left:0, behavior:'smooth'});
      } else {
        track.scrollBy({left:step, behavior:'smooth'});
      }
    }, 4000);
  });
})();
</script>`;
}

module.exports = async (req, res) => {
  // CORS (il configuratore è sullo stesso dominio, ma teniamo permissivo per sicurezza)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if(req.method === 'OPTIONS'){ res.status(200).end(); return; }
  if(req.method !== 'POST'){ res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    // ── 1. Leggi input ──
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { build, nomePc, prezzo } = body;
    // Dati cliente (opzionali) per il lead
    const cliente = {
      nome: body.cliente_nome || null,
      cognome: body.cliente_cognome || null,
      email: body.cliente_email || null,
      telefono: body.cliente_telefono || null,
      indirizzo: body.cliente_indirizzo || null,
      citta: body.cliente_citta || null,
      consenso: body.cliente_consenso === true,
    };

    if(!build || typeof build !== 'object'){
      res.status(400).json({ error: 'Manca il campo "build"' }); return;
    }
    if(!nomePc || !String(nomePc).trim()){
      res.status(400).json({ error: 'Manca il nome del PC' }); return;
    }
    const prezzoNum = parseFloat(prezzo);
    if(!prezzoNum || prezzoNum <= 0){
      res.status(400).json({ error: 'Prezzo non valido' }); return;
    }

    // ── 2. Config da env ──
    const SHOP = process.env.SHOPIFY_SHOP;
    const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
    const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
    if(!SHOP || !CLIENT_ID || !CLIENT_SECRET){
      res.status(500).json({ error: 'Configurazione server incompleta' }); return;
    }

    // ── 3. Token ──
    const token = await getAccessToken(SHOP, CLIENT_ID, CLIENT_SECRET);

    // ── 4. Genera descrizione HTML + codice-coppia ──
    const nome = String(nomePc).trim();
    const descrizioneHtml = generaDescrizioneHtml(build, nome);
    const titoloPC = `PC GAMING ${nome.toUpperCase()}`;

    // Codice-coppia univoco (collega prodotto e sconto). Es: "A7F3"
    const pairCode = Math.random().toString(36).substring(2, 6).toUpperCase();
    // Codice sconto che il cliente digita al checkout. Es: "PC15-A7F3"
    const codiceSconto = `PC15-${pairCode}`;
    // Timestamp di creazione (per la pulizia a 24h)
    const creatoTimestamp = Date.now();

    // Minuti di validità dello sconto (dal timer del configuratore).
    // Default 24h (1440 min) se non specificato; max 24h, min 5 min.
    let scontoMinuti = parseInt(req.body.scontoMinuti, 10);
    if (!Number.isFinite(scontoMinuti) || scontoMinuti <= 0) scontoMinuti = 1440;
    if (scontoMinuti > 1440) scontoMinuti = 1440;
    if (scontoMinuti < 5) scontoMinuti = 5;
    const scadenzaSconto = new Date(creatoTimestamp + scontoMinuti * 60000).toISOString();

    // ── 5. Crea prodotto con status UNLISTED (non in elenco) ──
    // UNLISTED: nascosto da ricerca, collezioni, catalogo e canali di vendita,
    // ma accessibile via link diretto. Disponibile da API 2025-10 in poi.
    const createMutation = `
      mutation productCreate($input: ProductInput!, $media: [CreateMediaInput!]) {
        productCreate(input: $input, media: $media) {
          product {
            id
            handle
            onlineStoreUrl
            variants(first: 1) { edges { node { id } } }
          }
          userErrors { field message }
        }
      }`;
    const createVars = {
      input: {
        title: titoloPC,
        descriptionHtml: descrizioneHtml,
        status: 'UNLISTED',
        productType: 'PC Gaming Custom',
        vendor: 'Minimal Gamers',
        tags: ['custom-build', 'configuratore', `pair-${pairCode}`, `creato-${creatoTimestamp}`],
      },
    };
    // Se è stata passata la foto del case, la aggiungiamo come media del prodotto
    const fotoCase = req.body.fotoCase;
    if (fotoCase && typeof fotoCase === 'string' && /^https:\/\//.test(fotoCase)) {
      createVars.media = [{
        originalSource: fotoCase,
        mediaContentType: 'IMAGE',
        alt: titoloPC,
      }];
    }
    const createData = await shopifyGraphQL(SHOP, token, createMutation, createVars);
    const createErrors = createData.productCreate.userErrors;
    if(createErrors && createErrors.length){
      throw new Error('productCreate: ' + JSON.stringify(createErrors));
    }
    const product = createData.productCreate.product;
    const productId = product.id;
    const variantId = product.variants.edges[0] && product.variants.edges[0].node.id;

    // ── 6. Imposta il PREZZO sulla variante (IVA inclusa) ──
    if(variantId){
      const priceMutation = `
        mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            userErrors { field message }
          }
        }`;
      const priceVars = {
        productId: productId,
        variants: [{ id: variantId, price: prezzoNum.toFixed(2) }],
      };
      await shopifyGraphQL(SHOP, token, priceMutation, priceVars);
    }

    // ── 7. Pubblica sul canale Online Store (necessario perché il link funzioni) ──
    // Recupera la publication "Online Store"
    const pubQuery = `query { publications(first: 10) { edges { node { id name } } } }`;
    const pubData = await shopifyGraphQL(SHOP, token, pubQuery, {});
    const onlineStore = pubData.publications.edges
      .map(e => e.node)
      .find(n => /online store/i.test(n.name));

    if(onlineStore){
      const publishMutation = `
        mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
          publishablePublish(id: $id, input: $input) {
            userErrors { field message }
          }
        }`;
      await shopifyGraphQL(SHOP, token, publishMutation, {
        id: productId,
        input: [{ publicationId: onlineStore.id }],
      });
    }

    // ── 8. Crea il CODICE SCONTO (1,5%) valido solo per questo prodotto ──
    // Il codice scade dopo scontoMinuti (allineato al timer del configuratore).
    // È limitato al prodotto appena creato, così non è spendibile altrove.
    let scontoCreato = false;
    try {
      const discountMutation = `
        mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
          discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
            codeDiscountNode { id }
            userErrors { field message code }
          }
        }`;
      const discountVars = {
        basicCodeDiscount: {
          title: `Sconto build ${pairCode} (creato-${creatoTimestamp})`,
          code: codiceSconto,
          startsAt: new Date(creatoTimestamp).toISOString(),
          endsAt: scadenzaSconto,
          customerSelection: { all: true },
          appliesOncePerCustomer: true,
          customerGets: {
            value: { percentage: 0.015 },
            items: {
              products: {
                productsToAdd: [productId],
              },
            },
          },
        },
      };
      const discountData = await shopifyGraphQL(SHOP, token, discountMutation, discountVars);
      const dErr = discountData.discountCodeBasicCreate.userErrors;
      if (dErr && dErr.length) {
        console.error('Errore codice sconto (non bloccante):', JSON.stringify(dErr));
      } else {
        scontoCreato = true;
      }
    } catch (eSconto) {
      // Se lo sconto fallisce, il prodotto resta comunque acquistabile a prezzo pieno
      console.error('Eccezione codice sconto (non bloccante):', String(eSconto.message || eSconto));
    }

    // ── 9. Costruisci URL prodotto ──
    // onlineStoreUrl può essere null appena creato; costruiamo da handle come fallback
    const handle = product.handle;
    const url = product.onlineStoreUrl || `https://www.minimalgamers.it/products/${handle}`;

    // URL che applica AUTOMATICAMENTE il codice sconto e porta al prodotto.
    // Formato Shopify: /discount/CODICE?redirect=/products/handle
    // Quando il cliente ci clicca, lo sconto è già applicato al carrello/checkout.
    const urlConSconto = scontoCreato
      ? `https://www.minimalgamers.it/discount/${codiceSconto}?redirect=/products/${handle}`
      : url;

    // Prezzo scontato (per il banner): 1,5% in meno
    const prezzoScontato = scontoCreato ? +(prezzoNum * 0.985).toFixed(2) : prezzoNum;

    // ── 10. Salva il lead su Supabase (non bloccante) ──
    // Se fallisce, il prodotto è già creato: non interrompiamo il flusso cliente.
    await salvaLeadSupabase({
      nome: cliente.nome,
      cognome: cliente.cognome,
      email: cliente.email,
      telefono: cliente.telefono,
      indirizzo: cliente.indirizzo,
      citta: cliente.citta,
      nome_pc: titoloPC,
      build_dettaglio: build,
      prezzo: prezzoNum,
      prezzo_scontato: prezzoScontato,
      codice_sconto: scontoCreato ? codiceSconto : null,
      shopify_product_id: productId,
      shopify_url: url,
      ha_comprato: false,
      consenso_privacy: cliente.consenso,
    });

    res.status(200).json({
      success: true,
      url: url,                    // URL semplice del prodotto
      urlConSconto: urlConSconto,  // URL che applica lo sconto in automatico
      productId: productId,
      titolo: titoloPC,
      // Dati sconto per il banner del configuratore
      sconto: scontoCreato,
      codiceSconto: scontoCreato ? codiceSconto : null,
      prezzoPieno: prezzoNum,
      prezzoScontato: prezzoScontato,
      scadenzaSconto: scontoCreato ? scadenzaSconto : null,
    });

  } catch (err) {
    console.error('Errore crea-pc:', err);
    res.status(500).json({ error: 'Errore creazione prodotto', dettaglio: String(err.message || err) });
  }
};
