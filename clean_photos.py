"""
CLEAN PHOTOS v3 — Edge-aware + gestione re-download
====================================================

Differenze rispetto a v1:
- Usa photo_quality_v3 (edge-aware bg removal, safety case bianchi)
- Distingue tra:
  * Prodotti DA RIMUOVERE definitivamente (foto irrecuperabili)
  * Prodotti DA RE-DOWNLOAD (foto sostituibile col prossimo nightly)
  * Prodotti SENZA FOTO file (rimossi)
- Genera prodotti_redownload.json per il nightly LISTINI
"""
import os
import sys
import json
import time
from collections import Counter
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from photo_quality import is_photo_good, clean_photo


class NumpyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.integer):
            return int(obj)
        if isinstance(obj, np.floating):
            return float(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return super().default(obj)

FOTO_DIR = os.environ.get("FOTO_DIR", "foto")
PRODOTTI_JSON = os.environ.get("PRODOTTI_JSON", "prodotti.json")
REPORT_OUT = os.environ.get("REPORT_OUT", "photo_cleanup_report.json")
REDOWNLOAD_OUT = os.environ.get("REDOWNLOAD_OUT", "prodotti_redownload.json")
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
    
    with open(PRODOTTI_JSON) as f:
        prodotti = json.load(f)
    
    # Mappa foto → prodotti
    foto_to_prods = {}
    prodotti_senza_foto = []
    for p in prodotti:
        img = p.get('_img') or p.get('img')
        if img:
            fname = os.path.basename(img)
            foto_to_prods.setdefault(fname, []).append(p)
        else:
            prodotti_senza_foto.append(p)
    
    print(f"📦 Prodotti totali: {len(prodotti)}")
    print(f"🖼️  Prodotti con foto: {sum(len(v) for v in foto_to_prods.values())}")
    print(f"❓ Prodotti SENZA foto: {len(prodotti_senza_foto)}")
    
    all_photo_files = sorted([
        f for f in os.listdir(FOTO_DIR)
        if f.endswith('.png') or f.endswith('.jpg') or f.endswith('.jpeg')
    ])
    print(f"📸 Foto su disco: {len(all_photo_files)}")
    print()
    
    stats = Counter()
    cleaned_files = []
    bad_files = []
    mpn_to_remove = []
    mpn_to_redownload = []
    errors = []
    
    t0 = time.time()
    
    for i, fname in enumerate(all_photo_files, 1):
        if i % 200 == 0:
            print(f"  ... {i}/{len(all_photo_files)} ({time.time()-t0:.0f}s)")
        
        path = os.path.join(FOTO_DIR, fname)
        
        try:
            result = is_photo_good(path)
        except Exception as e:
            errors.append({"file": fname, "error": str(e)[:100]})
            stats["error"] += 1
            continue
        
        if not result["ok"]:
            stats["bad"] += 1
            stats[f"bad_{result['reason']}"] += 1
            bad_files.append({
                "file": fname,
                "reason": result["reason"],
                "stats": result.get("stats", {}),
            })
            
            # Decisione: re-download O rimozione
            for p in foto_to_prods.get(fname, []):
                entry = {
                    "mpn": p.get("mpn"),
                    "brand": p.get("b"),
                    "categoria": p.get("c"),
                    "desc": (p.get("d") or "")[:80],
                    "img": fname,
                    "reason": result["reason"],
                    "_full_product": p,  # serve per il re-add quando la foto è OK
                }
                if result.get("mark_for_redownload"):
                    # Va in entrambe: rimosso dalla vetrina ora + retry nightly
                    mpn_to_remove.append(entry)
                    mpn_to_redownload.append(entry)
                else:
                    # Solo rimosso, no retry
                    mpn_to_remove.append(entry)
            
            # Cancello il file foto cattivo per non occupare spazio
            if not DRY_RUN:
                try:
                    os.remove(path)
                except Exception:
                    pass
            continue
        
        # Foto buona
        if result.get("needs_cleaning"):
            if not DRY_RUN:
                try:
                    success = clean_photo(path)
                    if success:
                        stats["cleaned"] += 1
                        cleaned_files.append(fname)
                    else:
                        # Safety triggered (case bianco): foto NON modificata, ma OK
                        stats["safety_kept_intact"] += 1
                except Exception as e:
                    stats["clean_failed"] += 1
                    errors.append({"file": fname, "error": f"clean: {str(e)[:80]}"})
            else:
                stats["would_clean"] += 1
        else:
            stats["already_ok"] += 1
    
    # Prodotti senza foto file → RIMUOVI dal listino MA SALVA in retry list
    # Il nightly LISTINI riproverà a scaricarle e li riaggiungerà se ci riesce
    for p in prodotti_senza_foto:
        entry = {
            "mpn": p.get("mpn"),
            "brand": p.get("b"),
            "categoria": p.get("c"),
            "desc": (p.get("d") or "")[:80],
            "img": None,
            "reason": "no_photo_file_at_all",
            # Salvo il prodotto completo per il re-add quando la foto sarà trovata
            "_full_product": p,
        }
        mpn_to_remove.append(entry)
        mpn_to_redownload.append(entry)  # va in entrambe le liste
    
    elapsed = time.time() - t0
    print()
    print(f"⏱️  Tempo totale: {elapsed:.0f}s")
    print()
    print(f"📊 RIASSUNTO FOTO:")
    print(f"   ✅ Già OK (no action):     {stats.get('already_ok', 0)}")
    print(f"   🧹 Pulite ora:             {stats.get('cleaned', 0)}")
    print(f"   🛡️  Case bianchi preservati:{stats.get('safety_kept_intact', 0)}")
    if DRY_RUN:
        print(f"   🧪 Sarebbero pulite:       {stats.get('would_clean', 0)}")
    print(f"   ❌ Cattive (totali):       {stats.get('bad', 0)}")
    
    print()
    print(f"📊 RIASSUNTO PRODOTTI:")
    print(f"   🗑️  Da rimuovere subito:   {len(mpn_to_remove)} (di cui {len(prodotti_senza_foto)} senza foto)")
    print(f"   🔁 Da re-scaricare:        {len(mpn_to_redownload)}")
    print(f"   📦 Prodotti tenuti:        {len(prodotti) - len(mpn_to_remove)}")
    
    bad_reasons = {k.replace('bad_', ''): v for k, v in stats.items() if k.startswith('bad_')}
    if bad_reasons:
        print(f"\nMotivi scarto foto:")
        for reason, count in sorted(bad_reasons.items(), key=lambda x: -x[1]):
            print(f"   • {reason:40s}: {count}")
    
    # Salvo report
    report = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "dry_run": DRY_RUN,
        "stats": dict(stats),
        "cleaned_files": cleaned_files[:50],
        "bad_files": bad_files,
        "mpn_to_remove": mpn_to_remove,
        "mpn_to_redownload": mpn_to_redownload,
        "errors": errors,
        "elapsed_seconds": round(elapsed, 1),
    }
    with open(REPORT_OUT, 'w') as f:
        json.dump(report, f, ensure_ascii=False, indent=2, cls=NumpyEncoder)
    print(f"\n📄 Report salvato: {REPORT_OUT}")
    
    # Salvo lista re-download separata (per nightly LISTINI)
    with open(REDOWNLOAD_OUT, 'w') as f:
        json.dump(mpn_to_redownload, f, ensure_ascii=False, indent=2, cls=NumpyEncoder)
    print(f"📄 Lista re-download: {REDOWNLOAD_OUT}")
    
    # Filtra prodotti.json: rimuovo solo quelli "to_remove"
    # Quelli "to_redownload" restano nel listino ma _img viene rimosso
    if not DRY_RUN:
        remove_mpn_set = {p["mpn"] for p in mpn_to_remove if p.get("mpn")}
        redownload_mpn_set = {p["mpn"] for p in mpn_to_redownload if p.get("mpn")}
        
        prodotti_clean = []
        for p in prodotti:
            mpn = p.get("mpn")
            if mpn in remove_mpn_set:
                continue  # rimosso
            if mpn in redownload_mpn_set:
                # Rimuovo riferimento foto (sarà ri-scaricato dal nightly)
                p = dict(p)  # copia
                p.pop('_img', None)
                p.pop('img', None)
                p['_needs_photo'] = True  # flag per nightly
            prodotti_clean.append(p)
        
        with open(PRODOTTI_JSON, 'w') as f:
            json.dump(prodotti_clean, f, ensure_ascii=False, separators=(',', ':'))
        
        print(f"\n📝 prodotti.json aggiornato: {len(prodotti)} → {len(prodotti_clean)}")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
