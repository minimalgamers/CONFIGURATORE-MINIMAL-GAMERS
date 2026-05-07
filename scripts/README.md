# Pipeline foto case — Guida utilizzo

Questa cartella contiene gli script Python che scaricano le foto dei case dai
siti dei produttori e le preparano per il configuratore (background trasparente,
formato webp ottimizzato).

## Cosa fanno gli script

Pipeline a 2 step:

```
1. scarica_foto_case.py   →  Scrapa i siti produttori, scarica foto raw
                              Output: assets/cases/raw/{brand}-{nome}.jpg
                                      data/catalog_produttori.json

2. processa_immagini.py   →  Background removal + resize + webp
                              Output: assets/cases/processed/{brand}-{nome}.webp
```

## Setup iniziale (una volta sola)

Apri il terminale, vai nella cartella del repo:

```bash
cd CONFIGURATORE-MINIMAL-GAMERS
```

Crea un ambiente Python isolato e installa le dipendenze:

```bash
python3 -m venv venv
source venv/bin/activate          # su macOS/Linux
# venv\Scripts\activate           # su Windows

pip install -r scripts/requirements.txt
```

L'installazione di `rembg` scarica un modello AI di ~170MB la prima volta.
Se sei su Mac M1/M2/M3, l'installazione è veloce. Su Windows può richiedere
qualche minuto in più per via di onnxruntime.

## Esecuzione step 1 — scaricare le foto

Test su un solo brand (consigliato la prima volta, per vedere se funziona):

```bash
python3 scripts/scarica_foto_case.py --brand lianli --limit 3
```

Output atteso:
```
14:23:01 | INFO    | [Lian Li] Avvio scraping…
14:23:02 | INFO    |   Catalogo: https://lian-li.com/product-category/cases/medium-case/
14:23:04 | INFO    |   → O11 Dynamic EVO
14:23:05 | INFO    |     [ok] lian-li-o11-dynamic-evo.jpg (243KB)
14:23:06 | INFO    |   → Lancool 216
14:23:07 | INFO    |     [ok] lian-li-lancool-216.jpg (198KB)
...
```

Se vedi gli "[ok]" → funziona. Lancia su tutti i brand:

```bash
python3 scripts/scarica_foto_case.py
```

Tempo stimato: **5-15 minuti** in base alla velocità della tua connessione e
quanti case hanno ogni produttore.

### Brand supportati

| Brand          | Metodo              | Affidabilità |
| -------------- | ------------------- | ------------ |
| Lian Li        | Scraping HTML       | Alta         |
| NZXT           | Shopify API JSON    | Massima      |
| Hyte           | Shopify API JSON    | Massima      |
| Fractal Design | Scraping HTML       | Media        |
| Corsair        | Scraping HTML       | Media        |

I siti che usano API JSON (NZXT, Hyte) sono i più affidabili perché ritornano
dati strutturati. Quelli con scraping HTML possono avere qualche fallimento
saltuario se i produttori cambiano il layout.

## Esecuzione step 2 — processare le foto

Una volta che hai scaricato le raw, applica background removal:

```bash
python3 scripts/processa_immagini.py
```

Tempo stimato: **2-5 secondi a foto** sul tuo computer (il modello AI va in
locale, è il bottleneck). Per 50 case → ~3 minuti totali.

Output finale in `assets/cases/processed/`: file `.webp` 1200×1200 con sfondo
trasparente, pronti per il configuratore.

## Comandi utili

```bash
# solo un brand (Lian Li)
python3 scripts/scarica_foto_case.py --brand lianli

# limita a 5 case per brand (testing rapido)
python3 scripts/scarica_foto_case.py --limit 5

# simula senza scaricare (vede solo cosa troverebbe)
python3 scripts/scarica_foto_case.py --dry-run

# rifà processamento immagini anche delle esistenti
python3 scripts/processa_immagini.py --force

# salta background removal (più veloce per testing)
python3 scripts/processa_immagini.py --no-bg-removal --limit 3
```

## Output: dove vanno le cose

```
CONFIGURATORE-MINIMAL-GAMERS/
├── data/
│   └── catalog_produttori.json    ← lista di tutti i case trovati con metadati
└── assets/
    └── cases/
        ├── raw/                   ← foto originali scaricate (jpg/png/webp)
        │   ├── lian-li-o11-dynamic-evo.jpg
        │   ├── nzxt-h6-flow.jpg
        │   └── ...
        └── processed/             ← foto processate, sfondo trasparente, 1200x1200 webp
            ├── lian-li-o11-dynamic-evo.webp
            ├── nzxt-h6-flow.webp
            └── ...
```

Il file `catalog_produttori.json` è cruciale: contiene la mappa nome case →
URL foto → file path. È quello che il configuratore userà per fare il match
con i case del tuo listino.

## Cosa fare se qualcosa va storto

**Errore: `Host not in allowlist` / `Connection refused`**
Stai eseguendo lo script in un ambiente con rete limitata. Esegui sul tuo
computer normale, non su Replit/CodeSpace gratuiti.

**Errore: `rembg: model download failed`**
La prima volta rembg scarica un modello AI. Riprova con connessione stabile.

**Errore: scraping ritorna 0 case**
Il produttore ha cambiato il layout del sito. Apri un issue, lo aggiorno.

**Foto sbagliata associata a un case**
Apri `data/catalog_produttori.json`, trova l'entry del case con foto sbagliata,
cancella il file `assets/cases/raw/{brand}-{nome}.jpg` corrispondente, e
sostituiscilo manualmente con la foto giusta. Poi rilancia
`processa_immagini.py --force`.
