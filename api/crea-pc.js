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

const { generaDescrizioneHtml } = require('./genera-descrizione.js');

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

    // ── 4. Genera descrizione HTML ──
    const nome = String(nomePc).trim();
    const descrizioneHtml = generaDescrizioneHtml(build, nome);
    const titoloPC = `PC GAMING ${nome.toUpperCase()}`;

    // ── 5. Crea prodotto (ACTIVE) ──
    const createMutation = `
      mutation productCreate($input: ProductInput!) {
        productCreate(input: $input) {
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
        status: 'ACTIVE',
        productType: 'PC Gaming Custom',
        vendor: 'Minimal Gamers',
        tags: ['custom-build', 'configuratore', `build-${Date.now()}`],
      },
    };
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

    // ── 8. Costruisci URL prodotto ──
    // onlineStoreUrl può essere null appena creato; costruiamo da handle come fallback
    const handle = product.handle;
    const url = product.onlineStoreUrl || `https://www.minimalgamers.it/products/${handle}`;

    res.status(200).json({
      success: true,
      url: url,
      productId: productId,
      titolo: titoloPC,
    });

  } catch (err) {
    console.error('Errore crea-pc:', err);
    res.status(500).json({ error: 'Errore creazione prodotto', dettaglio: String(err.message || err) });
  }
};
