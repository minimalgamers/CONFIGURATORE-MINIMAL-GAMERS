# Configuratore PC Gaming — Minimal Gamers

Configuratore PC Gaming per i clienti di Minimal Gamers, integrato con Shopify.

## Stato attuale

🚧 **In sviluppo iniziale** — Fase 1: pipeline foto case

## Struttura del progetto

```
.
├── index.html                  # Configuratore (single-page app)
├── api/                        # Vercel Serverless Functions
│   └── checkout.js             # Crea Draft Order Shopify (TODO)
├── data/
│   ├── catalog_produttori.json # Foto case dai produttori
│   └── prodotti.json           # Mapping coi listini Minimal Gamers (TODO)
├── assets/
│   └── cases/
│       ├── raw/                # Foto raw scaricate
│       └── processed/          # Foto pronte (webp, sfondo trasparente)
├── scripts/
│   ├── scarica_foto_case.py    # Scraper produttori
│   ├── processa_immagini.py    # Background removal + webp
│   ├── requirements.txt
│   └── README.md               # Guida pipeline foto
└── vercel.json                 # Config deploy
```

## Configurazione

Vedi `scripts/README.md` per la pipeline foto.

## Formula prezzo

Per ogni componente:

```
prezzo_cliente = prezzo_fornitore × 1.22 × 1.35
                                  └IVA┘  └markup┘
```

I valori `1.22` (IVA 22%) e `1.35` (markup 35%) sono configurabili in
`config.js` (TODO).

## Deploy

Push su `main` → Vercel deploy automatico.
