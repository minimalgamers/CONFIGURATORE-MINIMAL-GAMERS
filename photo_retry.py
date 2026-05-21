"""
PHOTO RETRY HELPER per il parser LISTINI nightly
==================================================

Modulo da integrare in aggiorna_listini_cloud.py per:

1. LEGGERE la lista prodotti_redownload.json (generata da clean_photos.py)
2. AGGIUNGERLI alla coda di download foto del nightly (popola_foto.py via SerpAPI)
3. APPLICARE photo_quality check a ogni nuova foto scaricata
4. RIADD i prodotti al listino se la foto è ora buona
5. AGGIORNARE prodotti_redownload.json (rimuove quelli recuperati, mantiene quelli ancora KO)

ESEMPIO INTEGRAZIONE in aggiorna_listini_cloud.py:

```python
# All'inizio dello script:
from photo_quality import is_photo_good, clean_photo
from photo_retry import (
    load_retry_list,
    apply_photo_quality_filter,
    save_retry_list,
    reintegrate_recovered_products,
)

# Dopo aver caricato i prodotti dai listini:
retry_list = load_retry_list("prodotti_redownload.json")

# Aggiungi gli MPN da retry alla coda foto (se non già presente)
for entry in retry_list:
    mpn = entry["mpn"]
    if mpn not in [p.get("mpn") for p in all_products]:
        # Re-add per scaricare la foto
        all_products.append(entry["_full_product"])

# Dopo popola_foto.py (scaricamento foto):
recovered, still_bad = apply_photo_quality_filter(all_products, FOTO_DIR)

# Aggiorna retry list
save_retry_list(still_bad, "prodotti_redownload.json")

# Riaggiungi prodotti recuperati al listino finale
all_products = reintegrate_recovered_products(all_products, recovered)
```
"""
import os
import json
from photo_quality import is_photo_good, clean_photo


def load_retry_list(path="prodotti_redownload.json"):
    """Carica la lista prodotti che devono essere ri-scaricati."""
    if not os.path.exists(path):
        return []
    with open(path) as f:
        return json.load(f)


def save_retry_list(entries, path="prodotti_redownload.json"):
    """Salva la lista aggiornata di prodotti ancora da ri-scaricare."""
    # Rimuovo i _full_product duplicati dal salvataggio (sono grossi)
    # Li ri-ricavo dal listino corrente al prossimo nightly
    clean_entries = []
    for e in entries:
        clean = {k: v for k, v in e.items() if k != '_full_product'}
        clean_entries.append(clean)
    with open(path, 'w') as f:
        json.dump(clean_entries, f, ensure_ascii=False, indent=2)


def apply_photo_quality_filter(all_products, foto_dir):
    """
    Per ogni prodotto con foto:
    - Applica photo_quality check
    - Se foto buona ma con sfondo bianco: pulisce in-place
    - Se foto cattiva: lo marca come "still_bad" (non viene aggiunto al listino)
    
    Returns: (recovered_products, still_bad_entries)
    """
    recovered = []
    still_bad = []
    
    for p in all_products:
        img_field = p.get('_img') or p.get('img')
        if not img_field:
            # Prodotto senza foto file (probabilmente download fallito)
            still_bad.append({
                "mpn": p.get("mpn"),
                "brand": p.get("b"),
                "categoria": p.get("c"),
                "desc": (p.get("d") or "")[:80],
                "img": None,
                "reason": "no_photo_file_at_all",
                "_full_product": p,
            })
            continue
        
        img_path = os.path.join(foto_dir, os.path.basename(img_field))
        if not os.path.exists(img_path):
            still_bad.append({
                "mpn": p.get("mpn"),
                "brand": p.get("b"),
                "categoria": p.get("c"),
                "desc": (p.get("d") or "")[:80],
                "img": img_field,
                "reason": "file_missing",
                "_full_product": p,
            })
            continue
        
        try:
            result = is_photo_good(img_path)
        except Exception as e:
            still_bad.append({
                "mpn": p.get("mpn"),
                "img": img_field,
                "reason": f"check_error: {str(e)[:50]}",
                "_full_product": p,
            })
            continue
        
        if result["ok"]:
            # Foto buona: pulisco se serve
            if result.get("needs_cleaning"):
                clean_photo(img_path)
            recovered.append(p)
        else:
            # Foto ancora cattiva
            entry = {
                "mpn": p.get("mpn"),
                "brand": p.get("b"),
                "categoria": p.get("c"),
                "desc": (p.get("d") or "")[:80],
                "img": img_field,
                "reason": result["reason"],
                "_full_product": p,
            }
            if result.get("mark_for_redownload"):
                still_bad.append(entry)
            # else: lo droppa definitivamente
    
    return recovered, still_bad


def reintegrate_recovered_products(current_products, recovered):
    """
    Restituisce la lista finale combinando current_products + recovered,
    deduplicando per MPN (priorità: prodotti recuperati > correnti).
    """
    seen_mpns = {p.get("mpn") for p in recovered}
    final = list(recovered)
    for p in current_products:
        if p.get("mpn") not in seen_mpns:
            final.append(p)
            seen_mpns.add(p.get("mpn"))
    return final


if __name__ == "__main__":
    # Test rapido
    retry = load_retry_list()
    print(f"Retry list: {len(retry)} entries")
    if retry:
        print(f"Sample: {retry[0]}")
