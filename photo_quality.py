"""
PHOTO QUALITY CHECKER per Minimal Gamers
==========================================

Modulo importato dal parser nightly per:
1. Analizzare ogni foto scaricata
2. Decidere se è "buona" (sfondo uniforme, soggetto riconoscibile)
3. Pulire lo sfondo se necessario
4. Marcare il prodotto come "skip" se foto inutilizzabile

Uso nel workflow:
    from photo_quality import is_photo_good, clean_photo
    
    for prodotto in prodotti:
        photo_path = prodotto.get('_img_path')
        if photo_path and os.path.exists(photo_path):
            result = is_photo_good(photo_path)
            if not result['ok']:
                # foto cattiva → rimuovi prodotto
                prodotto['_skip'] = True
                prodotto['_skip_reason'] = result['reason']
            elif result.get('needs_cleaning'):
                # foto opaca con sfondo bianco → ripulisci in-place
                clean_photo(photo_path)

Pipeline robusta basata su:
- File size minimo (6KB)
- Dimensione minima (35000 px²)
- Aspect ratio (0.30-4.0)
- Foto con sfondo già trasparente → verifica solo qualità soggetto
- Foto opache → controllo 4 angoli (bianco, nero, gradiente uniforme)
- Varianza colori soggetto (filtro brand-only)
- Bounding box soggetto

Coverage: ~99% delle foto reali, ~1% scartato (foto ambiente / errate)
"""
import os
from PIL import Image, ImageFilter
import numpy as np
from collections import deque


def _remove_white_background_flood(img):
    """Rimuove sfondo bianco con flood fill dagli angoli."""
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
    arr = np.array(img)
    h, w = arr.shape[:2]
    r, g, b, a = arr[:,:,0], arr[:,:,1], arr[:,:,2], arr[:,:,3]
    
    visited = np.zeros((h, w), dtype=bool)
    queue = deque()
    
    # Seed da bordi
    for y in [0, h-1]:
        for x in range(w):
            if r[y,x] >= 225 and g[y,x] >= 225 and b[y,x] >= 225 and not visited[y,x]:
                queue.append((y, x))
                visited[y, x] = True
    for x in [0, w-1]:
        for y in range(h):
            if r[y,x] >= 225 and g[y,x] >= 225 and b[y,x] >= 225 and not visited[y,x]:
                queue.append((y, x))
                visited[y, x] = True
    
    bg_mask = np.zeros((h, w), dtype=bool)
    while queue:
        y, x = queue.popleft()
        bg_mask[y, x] = True
        for dy, dx in [(-1,0),(1,0),(0,-1),(0,1)]:
            ny, nx = y+dy, x+dx
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx]:
                if r[ny,nx] >= 220 and g[ny,nx] >= 220 and b[ny,nx] >= 220:
                    visited[ny, nx] = True
                    queue.append((ny, nx))
    
    new_alpha = np.where(bg_mask, 0, 255).astype(np.uint8)
    
    # Anti-aliasing
    alpha_img = Image.fromarray(new_alpha)
    alpha_img = alpha_img.filter(ImageFilter.GaussianBlur(radius=0.7))
    new_alpha = np.array(alpha_img)
    
    # Anti-halo
    avg_rgb = ((r.astype(int) + g.astype(int) + b.astype(int)) / 3)
    near_white = (avg_rgb >= 220) & (new_alpha > 30)
    fade = ((255 - avg_rgb) * 7).clip(0, 255).astype(np.uint8)
    new_alpha = np.where(near_white, np.minimum(new_alpha, fade), new_alpha)
    
    arr[:,:,3] = new_alpha
    return Image.fromarray(arr, 'RGBA'), bg_mask


def _get_subject_bbox(alpha):
    """Bounding box dei pixel non trasparenti."""
    fg = alpha > 30
    if not fg.any():
        return None
    rows = np.any(fg, axis=1)
    cols = np.any(fg, axis=0)
    rmin, rmax = np.where(rows)[0][[0, -1]]
    cmin, cmax = np.where(cols)[0][[0, -1]]
    return rmin, cmin, rmax, cmax


def is_photo_good(img_path):
    """
    Restituisce dict:
        {ok: bool, reason: str, needs_cleaning: bool, stats: dict}
    
    ok=True → la foto è utilizzabile
    needs_cleaning=True → foto opaca con sfondo bianco da ripulire
    reason → motivo (per debug)
    """
    try:
        img = Image.open(img_path)
    except Exception:
        return {"ok": False, "reason": "cannot_open", "needs_cleaning": False, "stats": {}}
    
    file_size_kb = os.path.getsize(img_path) / 1024
    if file_size_kb < 6:
        return {"ok": False, "reason": "file_too_small", "needs_cleaning": False,
                "stats": {"kb": round(file_size_kb,1)}}
    
    w, h = img.size
    area = w * h
    
    # Dimensione minima
    if area < 35000 or w < 150 or h < 90:
        return {"ok": False, "reason": "img_too_small", "needs_cleaning": False,
                "stats": {"size": (w,h)}}
    
    # Aspect ratio estremo
    aspect = w / h
    if aspect < 0.30 or aspect > 4.0:
        return {"ok": False, "reason": "aspect_extreme", "needs_cleaning": False,
                "stats": {"aspect": round(aspect,2)}}
    
    # Converto in RGBA per analisi
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
    
    arr = np.array(img)
    a = arr[:,:,3]
    rgb = arr[:,:,:3]
    
    transparent_ratio = (a == 0).sum() / a.size
    needs_cleaning = False
    is_dark_bg = False
    
    # === CASO A: già pulita (sfondo trasparente) ===
    if transparent_ratio > 0.15:
        subject_mask = a > 30
        final_alpha = a
    else:
        # === CASO B: opaca → analizzo sfondo ===
        cs = 10
        corners_rgb = [
            rgb[:cs, :cs].reshape(-1, 3),
            rgb[:cs, -cs:].reshape(-1, 3),
            rgb[-cs:, :cs].reshape(-1, 3),
            rgb[-cs:, -cs:].reshape(-1, 3),
        ]
        light_corners = 0
        dark_corners = 0
        corner_means = []
        for c in corners_rgb:
            corner_means.append(c.mean(axis=0))
            if (c >= 225).all(axis=1).mean() > 0.55:
                light_corners += 1
            if (c <= 60).all(axis=1).mean() > 0.55:
                dark_corners += 1
        
        cross_corner_std = np.array(corner_means).std(axis=0).mean()
        total_solid = light_corners + dark_corners
        
        if total_solid < 2 and cross_corner_std > 50:
            return {"ok": False, "reason": "no_solid_bg_likely_environment", "needs_cleaning": False,
                    "stats": {"light": light_corners, "dark": dark_corners, "cc_std": round(cross_corner_std,1)}}
        
        if dark_corners >= 2 and light_corners < 2:
            # Sfondo scuro: tengo così com'è
            is_dark_bg = True
            avg_rgb = ((arr[:,:,0].astype(int) + arr[:,:,1].astype(int) + arr[:,:,2].astype(int)) / 3)
            subject_mask = avg_rgb > 40
            final_alpha = a
        elif light_corners >= 2:
            # Sfondo bianco: marco per pulizia
            needs_cleaning = True
            # Per validazione faccio rimozione virtuale
            try:
                _, bg_mask = _remove_white_background_flood(img)
                subject_mask = ~bg_mask
                final_alpha = np.where(bg_mask, 0, 255).astype(np.uint8)
            except Exception:
                return {"ok": False, "reason": "removal_failed", "needs_cleaning": False, "stats": {}}
        else:
            # Sfondo uniforme misto: tengo
            is_dark_bg = True
            subject_mask = np.ones((h, w), dtype=bool)
            final_alpha = a
    
    # === Validazione soggetto ===
    subject_ratio = subject_mask.sum() / subject_mask.size
    
    if subject_ratio < 0.06:
        return {"ok": False, "reason": "subject_too_small", "needs_cleaning": False,
                "stats": {"sub": round(subject_ratio,2)}}
    
    if transparent_ratio < 0.15 and subject_ratio > 0.97 and area > 100000 and not is_dark_bg:
        return {"ok": False, "reason": "subject_too_large_bad_removal", "needs_cleaning": False,
                "stats": {"sub": round(subject_ratio,2)}}
    
    bbox = _get_subject_bbox(final_alpha)
    if bbox is None:
        return {"ok": False, "reason": "no_subject", "needs_cleaning": False, "stats": {}}
    
    rmin, cmin, rmax, cmax = bbox
    bbox_area = (cmax - cmin + 1) * (rmax - rmin + 1)
    bbox_ratio = bbox_area / area
    
    if bbox_ratio < 0.08:
        return {"ok": False, "reason": "bbox_too_small", "needs_cleaning": False,
                "stats": {"bbox": round(bbox_ratio,2)}}
    
    # Varianza colori (brand-only detector)
    fg_pixels = rgb[subject_mask]
    if len(fg_pixels) < 50:
        return {"ok": False, "reason": "too_few_pixels", "needs_cleaning": False, "stats": {}}
    
    color_std = fg_pixels.std(axis=0).mean()
    fg_mean = fg_pixels.mean()
    
    if color_std < 12 and bbox_ratio < 0.25:
        return {"ok": False, "reason": "monochromatic_brand_only", "needs_cleaning": False,
                "stats": {"std": round(color_std,1)}}
    
    if fg_mean > 200 and color_std < 25:
        return {"ok": False, "reason": "very_light_low_variance_brand", "needs_cleaning": False,
                "stats": {"mean": round(fg_mean,1)}}
    
    return {
        "ok": True,
        "reason": "good",
        "needs_cleaning": needs_cleaning,
        "stats": {
            "sub": round(subject_ratio, 2),
            "bbox": round(bbox_ratio, 2),
            "std": round(color_std, 1),
            "size": (w, h),
        }
    }


def clean_photo(img_path):
    """
    Pulisce in-place una foto con sfondo bianco (la rende trasparente).
    Da chiamare solo se is_photo_good ha restituito needs_cleaning=True.
    """
    try:
        img = Image.open(img_path).convert('RGBA')
        cleaned, _ = _remove_white_background_flood(img)
        cleaned.save(img_path, 'PNG', optimize=True)
        return True
    except Exception as e:
        print(f"  ⚠️  clean_photo failed for {img_path}: {e}")
        return False


# === USO STANDALONE: processa una cartella foto + un prodotti.json ===
if __name__ == "__main__":
    import sys
    import json
    import shutil
    from collections import Counter
    
    if len(sys.argv) < 3:
        print("Uso: python photo_quality.py <prodotti.json> <foto_dir> [output_dir]")
        print()
        print("Esempio:")
        print("  python photo_quality.py prodotti.json ./foto/ ./output/")
        sys.exit(1)
    
    prodotti_path = sys.argv[1]
    foto_dir = sys.argv[2]
    output_dir = sys.argv[3] if len(sys.argv) > 3 else "./output"
    
    os.makedirs(output_dir, exist_ok=True)
    
    with open(prodotti_path) as f:
        prodotti = json.load(f)
    
    print(f"📦 Prodotti: {len(prodotti)}")
    
    prodotti_clean = []
    prodotti_rimossi = []
    reasons = Counter()
    
    for i, p in enumerate(prodotti, 1):
        if i % 200 == 0:
            print(f"  ... {i}/{len(prodotti)}")
        
        img_field = p.get('_img') or p.get('img')
        if not img_field:
            prodotti_clean.append(p)
            continue
        
        img_path = os.path.join(foto_dir, os.path.basename(img_field))
        if not os.path.exists(img_path):
            prodotti_rimossi.append({**p, "_skip_reason": "no_file"})
            reasons["no_file"] += 1
            continue
        
        result = is_photo_good(img_path)
        reasons[result["reason"]] += 1
        
        if result["ok"]:
            if result.get("needs_cleaning"):
                clean_photo(img_path)
            prodotti_clean.append(p)
        else:
            prodotti_rimossi.append({**p, "_skip_reason": result["reason"]})
    
    out_clean = os.path.join(output_dir, "prodotti.json")
    out_removed = os.path.join(output_dir, "prodotti_rimossi.json")
    
    with open(out_clean, 'w') as f:
        json.dump(prodotti_clean, f, ensure_ascii=False, separators=(',',':'))
    
    with open(out_removed, 'w') as f:
        json.dump(prodotti_rimossi, f, ensure_ascii=False, indent=2)
    
    print()
    print(f"✅ Prodotti tenuti:   {len(prodotti_clean)}")
    print(f"❌ Prodotti rimossi:  {len(prodotti_rimossi)}")
    print()
    print("Motivi scarto:")
    for reason, count in reasons.most_common():
        if reason not in ('good',):
            print(f"  • {reason:35s}: {count}")
