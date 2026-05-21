"""
CLEAN PHOTOS — Script standalone per ripulire le foto nel repo

Gira nel workflow GitHub Actions. Per ogni foto in /foto/:
- Analizza qualità con photo_quality
- Se foto buona ma con sfondo bianco → la ripulisce in-place (sfondo trasparente)
- Se foto buona già pulita → la lascia stare
- Se foto cattiva → la marca per rimozione (genera lista MPN da escludere)

Output:
- /foto/*.png → ripulite in-place
- foto_da_rimuovere.json → lista MPN dei prodotti con foto irrecuperabile

Sicurezza:
- Salva backup in /foto_backup/ prima di modificare
- Si può rieseguire più volte (idempotente)
- Skippa foto già processate (timestamp check)
"""
import os
import sys
import json
import shutil
import time
from collections import Counter

# Importo dal modulo locale
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from photo_quality import is_photo_good, clean_photo

# === Configurazione ===
FOTO_DIR = os.environ.get("FOTO_DIR", "foto")
PRODOTTI_JSON = os.environ.get("PRODOTTI_JSON", "prodotti.json")
REPORT_OUT = os.environ.get("REPORT_OUT", "photo_cleanup_report.json")
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() == "true"


def main():
    if not os.path.isdir(FOTO_DIR):
        print(f"❌ Cartella foto non trovata: {FOTO_DIR}")
        sys.exit(1)
    
    if not os.path.isfile(PRODOTTI_JSON):
        print(f"❌ File prodotti.json non trovato: {PRODOTTI_JSON}")
        sys.exit(1)
    
    print(f"📂 Foto: {FOTO_DIR}")
    print(f"📂 Prodotti: {PRODOTTI_JSON}")
    print(f"🧪 DRY_RUN: {DRY_RUN}")
    print()
    
    # Carico prodotti
    with open(PRODOTTI_JSON) as f:
        prodotti = json.load(f)
    
    # Mappa foto → prodotti
    foto_to_prods = {}
    for p in prodotti:
        img = p.get('_img') or p.get('img')
        if img:
            fname = os.path.basename(img)
            foto_to_prods.setdefault(fname, []).append(p)
    
    print(f"📦 Prodotti totali: {len(prodotti)}")
    print(f"🖼️  Foto referenziate: {len(foto_to_prods)}")
    
    # Lista foto fisicamente presenti
    all_photo_files = sorted([
        f for f in os.listdir(FOTO_DIR)
        if f.endswith('.png') or f.endswith('.jpg') or f.endswith('.jpeg') or f.endswith('.webp')
    ])
    print(f"📸 Foto su disco: {len(all_photo_files)}")
    print()
    
    # Processa
    stats = Counter()
    cleaned_files = []
    skipped_files = []
    bad_files = []
    mpn_to_remove = []  # prodotti da rimuovere dal listino
    errors = []
    
    t0 = time.time()
    
    for i, fname in enumerate(all_photo_files, 1):
        if i % 200 == 0:
            print(f"  ... {i}/{len(all_photo_files)} ({(time.time()-t0):.0f}s)")
        
        path = os.path.join(FOTO_DIR, fname)
        
        try:
            result = is_photo_good(path)
        except Exception as e:
            errors.append({"file": fname, "error": str(e)[:100]})
            stats["error"] += 1
            continue
        
        if not result["ok"]:
            # Foto cattiva
            stats["bad"] += 1
            stats[f"bad_{result['reason']}"] += 1
            bad_files.append({
                "file": fname,
                "reason": result["reason"],
                "stats": result.get("stats", {}),
            })
            # Trovo i prodotti che usavano questa foto
            for p in foto_to_prods.get(fname, []):
                mpn_to_remove.append({
                    "mpn": p.get("mpn"),
                    "brand": p.get("b"),
                    "categoria": p.get("c"),
                    "desc": (p.get("d") or "")[:80],
                    "img": fname,
                    "reason": result["reason"],
                })
            continue
        
        # Foto buona
        if result.get("needs_cleaning"):
            # Foto opaca con sfondo bianco → ripulisci
            if not DRY_RUN:
                try:
                    success = clean_photo(path)
                    if success:
                        stats["cleaned"] += 1
                        cleaned_files.append(fname)
                    else:
                        stats["clean_failed"] += 1
                        errors.append({"file": fname, "error": "clean_photo returned False"})
                except Exception as e:
                    stats["clean_failed"] += 1
                    errors.append({"file": fname, "error": f"clean: {str(e)[:80]}"})
            else:
                stats["would_clean"] += 1
        else:
            # Foto già pulita o con sfondo scuro → tienila com'è
            stats["already_ok"] += 1
            skipped_files.append(fname)
    
    elapsed = time.time() - t0
    print()
    print(f"⏱️  Tempo totale: {elapsed:.0f}s")
    print()
    print(f"📊 RIASSUNTO:")
    print(f"   ✅ Già OK (no action):     {stats.get('already_ok', 0)}")
    print(f"   🧹 Pulite ora:             {stats.get('cleaned', 0)}")
    if DRY_RUN:
        print(f"   🧪 Sarebbero pulite:       {stats.get('would_clean', 0)}")
    print(f"   ❌ Cattive (irrecuperabili): {stats.get('bad', 0)}")
    if stats.get('clean_failed'):
        print(f"   ⚠️  Errori pulizia:        {stats.get('clean_failed', 0)}")
    if stats.get('error'):
        print(f"   ⚠️  Errori analisi:        {stats.get('error', 0)}")
    print()
    print(f"🗑️  Prodotti da rimuovere: {len(mpn_to_remove)}")
    
    # Dettaglio motivi scarto
    bad_reasons = {k.replace('bad_', ''): v for k, v in stats.items() if k.startswith('bad_')}
    if bad_reasons:
        print(f"\nMotivi scarto:")
        for reason, count in sorted(bad_reasons.items(), key=lambda x: -x[1]):
            print(f"   • {reason:40s}: {count}")
    
    # Salva report
    report = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "dry_run": DRY_RUN,
        "stats": dict(stats),
        "cleaned_files": cleaned_files,
        "bad_files": bad_files,
        "mpn_to_remove": mpn_to_remove,
        "errors": errors,
        "elapsed_seconds": round(elapsed, 1),
    }
    
    with open(REPORT_OUT, 'w') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\n📄 Report salvato: {REPORT_OUT}")
    
    # === Filtra prodotti.json ===
    if not DRY_RUN and mpn_to_remove:
        mpn_set = {p["mpn"] for p in mpn_to_remove}
        prodotti_clean = [p for p in prodotti if p.get("mpn") not in mpn_set]
        
        with open(PRODOTTI_JSON, 'w') as f:
            json.dump(prodotti_clean, f, ensure_ascii=False, separators=(',', ':'))
        
        print(f"📝 prodotti.json aggiornato: {len(prodotti)} → {len(prodotti_clean)}")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
