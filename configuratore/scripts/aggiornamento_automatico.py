"""
AGGIUNTA AD aggiorna_listini_cloud.py
======================================
Aggiunge alla fine del main() la generazione di prodotti.json
e il push automatico al repo CONFIGURATORE-MINIMAL-GAMERS.

ISTRUZIONI:
1. Copia la funzione `build_prodotti_json()` nel tuo aggiorna_listini_cloud.py
2. Aggiungi la chiamata a fondo del main(), dopo build_html()
3. Aggiungi GH_TOKEN come secret in GitHub Actions (già ce l'hai come GH_TOKEN)
4. Nel workflow aggiorna.yml, aggiungi GH_TOKEN: ${{ secrets.GH_TOKEN }} all'env
"""

import json
import re
import requests
import base64
from datetime import datetime

# ── MAPPING CATEGORIE (copia in aggiorna_listini_cloud.py) ──────────────────

CAT_MAP_CONFIGURATORE = {
    # CASE
    'Cases & Modding > PC Cases': 'Case',
    'Enclosures and power supplies > Computer cases': 'Case',
    'Power supplies for computers and laptops > Cases power supply': 'Case',
    # CPU
    'CPUS': 'CPU',
    'PC Components > CPUs / Processors': 'CPU',
    'Processors > AMD Ryzen processors': 'CPU',
    'Processors > Intel Core i5 processors': 'CPU',
    'Processors > Intel Core i7 processors': 'CPU',
    'Processors > Intel Core i9 processors': 'CPU',
    'Processors > Intel Core i3 processors': 'CPU',
    # GPU
    'PC Components > Graphics Cards': 'GPU',
    'Graphics cards > Graphics card (NVIDIA Graphics PLUS)': 'GPU',
    'Graphics cards > Graphics cards (ATI)': 'GPU',
    'Graphics cards > Graphics card (INTEL)': 'GPU',
    'VIDEO CARDS': 'GPU',
    # RAM
    'Memory devices > DIMM (DDR V)': 'RAM',
    'Memory devices > DIMM (DDR IV)': 'RAM',
    'PC Components > Memory': 'RAM',
    'MEMORY': 'RAM',
    # MOBO
    'PC Components > Mainboards': 'Scheda Madre',
    'motherboards > Motherboards Socket-AM5': 'Scheda Madre',
    'motherboards > Motherboards Socket-1700': 'Scheda Madre',
    'motherboards > Motherboards Socket-1851': 'Scheda Madre',
    'motherboards > Motherboards Socket-1200': 'Scheda Madre',
    'MOTHERBOARD': 'Scheda Madre',
    # SSD
    'Drives and accessories > SSDs': 'SSD',
    'PC Components > Drives': 'SSD',
    'SSD': 'SSD',
    'Storage': 'SSD',
    # PSU
    'PC Components > Power Supplies': 'PSU',
    # DISSIPATORI
    'Aircooling > Coolers': 'Dissipatore',
    'Liquid Cooling > Sets & Bundles': 'Dissipatore',
    'Liquid Cooling > Liquid Coolers': 'Dissipatore',
    'Cooling > CPU cooling': 'Dissipatore',
    'Cooling > Cooling - water cooling kits': 'Dissipatore',
    'COOLERS': 'Dissipatore',
}

BRAND_NORM = {
    'LIAN LI': 'Lian Li', 'lian li': 'Lian Li',
    'PHANTEKS': 'Phanteks', 'BE QUIET!': 'be quiet!',
    'DEEPCOOL': 'Deepcool', 'ASROCK': 'ASRock',
    'HYTE': 'Hyte', 'be quiet': 'be quiet!',
}
KNOWN_BRANDS = [
    'AMD', 'Intel', 'ASUS', 'MSI', 'Gigabyte', 'Corsair', 'Kingston',
    'G.Skill', 'Samsung', 'WD', 'Seagate', 'Crucial', 'NZXT', 'Lian Li',
    'Fractal Design', 'Phanteks', 'Cooler Master', 'Deepcool', 'Silverstone',
    'Jonsbo', 'Kolink', 'Seasonic', 'Thermaltake', 'Aerocool', 'Montech',
    'Akasa', 'be quiet!', 'PowerColor', 'Sapphire', 'ZOTAC', 'Palit',
    'INNO3D', 'XFX', 'Gainward', 'Biostar', 'ASRock', 'Hyte', 'Noctua',
    'DeepCool', 'Arctic', 'ID-Cooling', 'SilentiumPC', 'Antec',
]
EXCLUDE_KEYWORDS = ['epyc', 'xeon', 'threadripper', 'pentium', 'celeron', 'wraith', 'athlon']


def fix_brand(prod):
    b = (prod.get('b') or '').strip()
    b = BRAND_NORM.get(b, b)
    if b and b not in ['nan', 'N/A', '']:
        return b
    d = prod['d']
    for k in KNOWN_BRANDS:
        if d.lower().startswith(k.lower()):
            return BRAND_NORM.get(k, k)
    return d.split()[0][:20] if d else 'N/A'


def build_prodotti_json(all_products):
    """
    A partire da all_products (lista dicts dal parser),
    genera il JSON normalizzato per il configuratore.
    """
    output = []
    for p in all_products:
        cat = CAT_MAP_CONFIGURATORE.get(p.get('c', ''))
        if not cat:
            continue
        # Escludi CPU non consumer
        if any(k in p['d'].lower() for k in EXCLUDE_KEYWORDS):
            continue
        price = p.get('p', 0)
        if not price or price <= 0:
            continue
        stock = p.get('stock')
        if stock is None:
            stock = 99  # disponibile (stock non tracciato da questo fornitore)

        output.append({
            'd': p['d'],
            's': p['s'],
            'p': round(float(price), 2),
            'k': p.get('k', ''),
            'c': cat,
            'b': fix_brand(p),
            'mpn': p.get('mpn', '') or '',
            'stock': int(stock),
            'incoming': p.get('incoming'),
        })

    print(f"  Prodotti configuratore generati: {len(output)}")
    return output


def push_prodotti_json_to_configuratore(prodotti, gh_token, repo='minimalgamers/CONFIGURATORE-MINIMAL-GAMERS'):
    """
    Fa il push di prodotti.json nel repo del configuratore via GitHub API.
    Aggiorna il file se esiste, lo crea se non esiste.
    """
    import base64

    headers = {
        'Authorization': f'token {gh_token}',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
    }
    api_url = f'https://api.github.com/repos/{repo}/contents/prodotti.json'

    # Genera il JSON
    content = json.dumps(prodotti, ensure_ascii=False, separators=(',', ':'))
    content_b64 = base64.b64encode(content.encode('utf-8')).decode('ascii')

    # Controlla se il file esiste già (per ottenere il SHA)
    r = requests.get(api_url, headers=headers, timeout=15)
    sha = r.json().get('sha') if r.status_code == 200 else None

    # Payload
    payload = {
        'message': f'Aggiornamento prodotti configuratore {datetime.now().strftime("%d/%m/%Y %H:%M")}',
        'content': content_b64,
        'branch': 'main',
    }
    if sha:
        payload['sha'] = sha  # necessario per aggiornare file esistente

    r = requests.put(api_url, headers=headers, json=payload, timeout=30)

    if r.status_code in (200, 201):
        print(f'  ✓ prodotti.json pushato su {repo} ({len(content)//1024} KB, {len(prodotti)} prodotti)')
        return True
    else:
        print(f'  ✗ Errore push prodotti.json: HTTP {r.status_code}')
        print(f'    {r.text[:200]}')
        return False


# ── COME INTEGRARE IN main() ─────────────────────────────────────────────────
"""
Aggiungi questi 3 step alla fine del main(), dopo build_html():

    # ── GENERA E PUSHA prodotti.json PER IL CONFIGURATORE ──
    print("\\n🎮 AGGIORNAMENTO CONFIGURATORE")
    gh_token = os.environ.get('GH_TOKEN', '')
    if gh_token:
        prodotti_conf = build_prodotti_json(all_products)
        push_prodotti_json_to_configuratore(prodotti_conf, gh_token)
    else:
        print("  ⚠  GH_TOKEN non trovato — skip push configuratore")

E nel workflow .github/workflows/aggiorna.yml, aggiungi GH_TOKEN all'env:

    env:
      GMAIL_PASSWORD: ${{ secrets.GMAIL_PASSWORD }}
      ACTION_PASSWORD: ${{ secrets.ACTION_PASSWORD }}
      GH_TOKEN: ${{ secrets.GH_TOKEN }}
"""
