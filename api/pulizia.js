// ════════════════════════════════════════════════════════════════════
// SCRIPT DI PULIZIA — Minimal Gamers
// Cancella prodotti custom + codici sconto più vecchi di 24 ore.
//
// SICUREZZA (triplo filtro, impossibile toccare i prodotti nativi):
//   1. Solo prodotti con TUTTI i tag: 'custom-build' E 'configuratore'
//   2. Solo quelli con tag 'creato-<timestamp>' più vecchio di 24h
//   3. Solo quelli MAI venduti (nessun ordine)
//   I prodotti nativi (PERFY, INFERNUS...) non hanno questi tag → invisibili allo script.
//
// MODALITÀ:
//   - DRY RUN (default): mostra SOLO cosa cancellerebbe, senza cancellare nulla.
//   - LIVE: cancella davvero. Si attiva con ?confirm=ELIMINA nella chiamata.
//
// COME SI USA:
//   - Anteprima:  GET /api/pulizia
//   - Esecuzione: GET /api/pulizia?confirm=ELIMINA
//   - (opzionale, per cron automatico: aggiungere &secret=LA_TUA_PAROLA)
//
// VARIABILI D'AMBIENTE (già impostate su Vercel):
//   SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SHOPIFY_SHOP
//   (opzionale) PULIZIA_SECRET = parola per proteggere l'esecuzione automatica
// ════════════════════════════════════════════════════════════════════

const API_VERSION = '2026-04';
const ORE_VALIDITA = 24;            // durata di vita di build e codici
const MAX_DA_PROCESSARE = 100;      // limite di sicurezza per esecuzione

let _tokenCache = { token: null, expiresAt: 0 };

async function getAccessToken(shop, clientId, clientSecret){
  const now = Date.now();
  if(_tokenCache.token && now < _tokenCache.expiresAt - 300000) return _tokenCache.token;
  const res = await fetch(`https://${shop}.myshopify.com/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
  });
  if(!res.ok) throw new Error(`Token error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  _tokenCache = { token: data.access_token, expiresAt: now + (data.expires_in || 86399) * 1000 };
  return data.access_token;
}

async function shopifyGraphQL(shop, token, query, variables){
  const res = await fetch(`https://${shop}.myshopify.com/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if(data.errors) throw new Error('GraphQL: ' + JSON.stringify(data.errors));
  return data.data;
}

// Estrae il timestamp dal tag "creato-<numero>"
function getCreatoTimestamp(tags){
  for(const t of tags){
    const m = /^creato-(\d+)$/.exec(t);
    if(m) return parseInt(m[1], 10);
  }
  return null;
}
// Estrae il pair code dal tag "pair-XXXX"
function getPairCode(tags){
  for(const t of tags){
    const m = /^pair-([A-Z0-9]+)$/.exec(t);
    if(m) return m[1];
  }
  return null;
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    const SHOP = process.env.SHOPIFY_SHOP;
    const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
    const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
    if(!SHOP || !CLIENT_ID || !CLIENT_SECRET){
      res.status(500).json({ error: 'Configurazione server incompleta' }); return;
    }

    // Protezione opzionale per esecuzione automatica (cron)
    const PULIZIA_SECRET = process.env.PULIZIA_SECRET;
    const query = req.query || {};
    if(PULIZIA_SECRET && query.secret && query.secret !== PULIZIA_SECRET){
      res.status(403).json({ error: 'Secret non valido' }); return;
    }

    // DRY RUN di default. Cancella davvero in due casi:
    //  1. chiamata manuale con ?confirm=ELIMINA
    //  2. chiamata automatica dal cron di Vercel (header x-vercel-cron presente)
    const isCron = !!(req.headers && (req.headers['x-vercel-cron'] || req.headers['X-Vercel-Cron']));
    const isLive = query.confirm === 'ELIMINA' || isCron;

    const token = await getAccessToken(SHOP, CLIENT_ID, CLIENT_SECRET);
    const sogliaMs = Date.now() - ORE_VALIDITA * 3600 * 1000;

    // ── 1. Trova i prodotti custom (tag custom-build + configuratore) ──
    const prodQuery = `
      query($cursor: String) {
        products(first: 50, after: $cursor, query: "tag:custom-build AND tag:configuratore") {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id
              title
              tags
              totalInventory
              createdAt
            }
          }
        }
      }`;

    let prodottiDaCancellare = [];
    let prodottiVendutiSaltati = 0;
    let prodottiRecentiSaltati = 0;
    let cursor = null;
    let pagine = 0;

    while(pagine < 10){
      pagine++;
      const data = await shopifyGraphQL(SHOP, token, prodQuery, { cursor });
      const edges = data.products.edges;
      for(const e of edges){
        const p = e.node;
        const ts = getCreatoTimestamp(p.tags);
        // Senza timestamp valido → salto per sicurezza (non lo tocco)
        if(ts === null) continue;
        // Più recente di 24h → salto
        if(ts > sogliaMs){ prodottiRecentiSaltati++; continue; }

        prodottiDaCancellare.push({
          id: p.id,
          title: p.title,
          pair: getPairCode(p.tags),
          creato: new Date(ts).toISOString(),
          eta_ore: Math.round((Date.now() - ts) / 3600000),
        });
        if(prodottiDaCancellare.length >= MAX_DA_PROCESSARE) break;
      }
      if(!data.products.pageInfo.hasNextPage || prodottiDaCancellare.length >= MAX_DA_PROCESSARE) break;
      cursor = data.products.pageInfo.endCursor;
    }

    // ── 2. Verifica vendite per ciascun prodotto candidato ──
    // Un prodotto è "venduto" se appare in almeno un ordine.
    const daCancellareFiltrati = [];
    for(const prod of prodottiDaCancellare){
      const numId = prod.id.split('/').pop();
      const ordCheck = await shopifyGraphQL(SHOP, token, `
        query($q: String!) {
          orders(first: 1, query: $q) { edges { node { id name } } }
        }`, { q: `line_items_product_id:${numId}` });
      const venduto = ordCheck.orders.edges.length > 0;
      if(venduto){
        prodottiVendutiSaltati++;
      } else {
        daCancellareFiltrati.push(prod);
      }
    }

    // ── 3. Trova i codici sconto scaduti da cancellare ──
    // Cerchiamo gli sconti con titolo che contiene "creato-<ts>" più vecchio di 24h
    const discQuery = `
      query($cursor: String) {
        codeDiscountNodes(first: 50, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id
              codeDiscount {
                ... on DiscountCodeBasic {
                  title
                  endsAt
                }
              }
            }
          }
        }
      }`;

    let scontiDaCancellare = [];
    let dcursor = null;
    let dpagine = 0;
    while(dpagine < 10){
      dpagine++;
      const data = await shopifyGraphQL(SHOP, token, discQuery, { cursor: dcursor });
      const edges = data.codeDiscountNodes.edges;
      for(const e of edges){
        const node = e.node;
        const cd = node.codeDiscount;
        if(!cd || !cd.title) continue;
        // Solo i NOSTRI sconti: titolo che inizia con "Sconto build"
        if(!/^Sconto build /.test(cd.title)) continue;
        const m = /creato-(\d+)/.exec(cd.title);
        if(!m) continue;
        const ts = parseInt(m[1], 10);
        if(ts > sogliaMs) continue; // più recente di 24h → salto
        scontiDaCancellare.push({
          id: node.id,
          title: cd.title,
          eta_ore: Math.round((Date.now() - ts) / 3600000),
        });
        if(scontiDaCancellare.length >= MAX_DA_PROCESSARE) break;
      }
      if(!data.codeDiscountNodes.pageInfo.hasNextPage || scontiDaCancellare.length >= MAX_DA_PROCESSARE) break;
      dcursor = data.codeDiscountNodes.pageInfo.endCursor;
    }

    // ── 4. Esecuzione (solo se LIVE) ──
    let prodottiCancellati = 0;
    let scontiCancellati = 0;
    const erroriCancellazione = [];

    if(isLive){
      // Cancella prodotti
      for(const prod of daCancellareFiltrati){
        try {
          const r = await shopifyGraphQL(SHOP, token, `
            mutation($id: ID!) {
              productDelete(input: {id: $id}) {
                deletedProductId
                userErrors { field message }
              }
            }`, { id: prod.id });
          if(r.productDelete.deletedProductId) prodottiCancellati++;
          else erroriCancellazione.push('Prod ' + prod.title + ': ' + JSON.stringify(r.productDelete.userErrors));
        } catch(e){ erroriCancellazione.push('Prod ' + prod.title + ': ' + String(e.message)); }
      }
      // Cancella sconti
      for(const sconto of scontiDaCancellare){
        try {
          const r = await shopifyGraphQL(SHOP, token, `
            mutation($id: ID!) {
              discountCodeDelete(id: $id) {
                deletedCodeDiscountId
                userErrors { field message }
              }
            }`, { id: sconto.id });
          if(r.discountCodeDelete.deletedCodeDiscountId) scontiCancellati++;
          else erroriCancellazione.push('Sconto ' + sconto.title + ': ' + JSON.stringify(r.discountCodeDelete.userErrors));
        } catch(e){ erroriCancellazione.push('Sconto ' + sconto.title + ': ' + String(e.message)); }
      }
    }

    // ── 5. Risposta ──
    res.status(200).json({
      modalita: isLive ? (isCron ? 'CRON AUTOMATICO (cancellazione eseguita)' : 'LIVE (cancellazione eseguita)') : 'ANTEPRIMA (nessuna cancellazione - aggiungi ?confirm=ELIMINA per eseguire)',
      sogliaOre: ORE_VALIDITA,
      prodotti: {
        daCancellare: daCancellareFiltrati.length,
        cancellati: prodottiCancellati,
        saltatiPerchéVenduti: prodottiVendutiSaltati,
        saltatiPerchéRecenti: prodottiRecentiSaltati,
        lista: daCancellareFiltrati,
      },
      sconti: {
        daCancellare: scontiDaCancellare.length,
        cancellati: scontiCancellati,
        lista: scontiDaCancellare,
      },
      errori: erroriCancellazione,
    });

  } catch (err) {
    console.error('Errore pulizia:', err);
    res.status(500).json({ error: 'Errore pulizia', dettaglio: String(err.message || err) });
  }
};
