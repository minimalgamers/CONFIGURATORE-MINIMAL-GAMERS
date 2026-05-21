"""
PHOTO QUALITY CHECKER v3 — Edge-aware background removal
=========================================================

Migliorie principali rispetto a v2:

1. **Rilevamento oggetto via edge detection (Canny + Sobel)**:
   Il flood-fill non attraversa i bordi del prodotto, anche se il prodotto è
   bianco/chiaro come lo sfondo. Risolve il problema dei "case bianchi mangiati".

2. **Tolleranza colore adattiva**:
   Campiona il colore esatto degli angoli e rimuove SOLO pixel molto vicini
   (±5 RGB) invece di un range fisso. Se il prodotto è anche bianco ma con
   colore leggermente diverso (es. 240,240,242 vs sfondo 255,255,255),
   non viene toccato.

3. **Safety check anti-cannibalizzazione**:
   Se il flood-fill rimuoverebbe >88% dell'immagine, annulla — significa
   che ha attraversato il prodotto.

4. **Detection foto-ambiente più severa**:
   Aggiunge check skin-tone (mani umane) e variance globale per beccare
   meglio le foto in ambiente.

5. **Detection video thumbnail**:
   Cerca il pattern del triangolo play YouTube al centro.

6. **Detection brand-only più stretta**:
   Se l'unica cosa significativa è testo grande grigio centrale → scarto.
"""
import os
from PIL import Image, ImageFilter
import numpy as np
from collections import deque


def _detect_edges(img_array_gray):
    """
    Rileva bordi via Sobel (più semplice di Canny, sufficiente per il nostro scopo).
    Ritorna mask booleana True dove ci sono bordi.
    """
    arr = img_array_gray.astype(np.float32)
    
    # Sobel kernels
    # Gx detects vertical edges, Gy horizontal
    h, w = arr.shape
    
    # Padding
    padded = np.pad(arr, 1, mode='edge')
    
    # Sobel X
    gx = (
        -padded[:-2, :-2] - 2*padded[1:-1, :-2] - padded[2:, :-2]
        + padded[:-2, 2:] + 2*padded[1:-1, 2:] + padded[2:, 2:]
    )
    # Sobel Y
    gy = (
        -padded[:-2, :-2] - 2*padded[:-2, 1:-1] - padded[:-2, 2:]
        + padded[2:, :-2] + 2*padded[2:, 1:-1] + padded[2:, 2:]
    )
    
    magnitude = np.sqrt(gx*gx + gy*gy)
    
    # Threshold adattivo: usa il 90° percentile come soglia
    threshold = np.percentile(magnitude, 88)
    threshold = max(threshold, 15)  # minimo 15 per evitare rumore
    
    return magnitude > threshold


def _sample_bg_color(rgb, corner_size=8):
    """Campiona il colore mediano dei 4 angoli per stimare lo sfondo."""
    h, w = rgb.shape[:2]
    corners = np.concatenate([
        rgb[:corner_size, :corner_size].reshape(-1, 3),
        rgb[:corner_size, -corner_size:].reshape(-1, 3),
        rgb[-corner_size:, :corner_size].reshape(-1, 3),
        rgb[-corner_size:, -corner_size:].reshape(-1, 3),
    ])
    return np.median(corners, axis=0).astype(int)


def _remove_bg_smart(img, color_tolerance=8):
    """
    Edge-aware background removal.
    
    Algoritmo:
    1. Campiona colore esatto sfondo dagli angoli
    2. Calcola edge map (bordi del prodotto)
    3. Flood-fill dai bordi dell'immagine
       - Si propaga solo su pixel "simili" al colore sfondo (tolleranza ±N)
       - Si FERMA appena trova un edge (bordo del prodotto)
    4. Safety: se rimuoverebbe >88% dell'immagine, annulla
    
    Restituisce: (Image RGBA pulita, bg_mask) o (img originale, None se annullato)
    """
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
    arr = np.array(img)
    h, w = arr.shape[:2]
    rgb = arr[:, :, :3]
    
    # 1. Campiono colore sfondo
    bg_color = _sample_bg_color(rgb)
    
    # 2. Edge detection
    gray = (rgb[:,:,0].astype(int) + rgb[:,:,1].astype(int) + rgb[:,:,2].astype(int)) // 3
    edges = _detect_edges(gray)
    
    # Maschera pixel "candidato sfondo": colore vicino al bg + NON bordo
    color_diff = np.abs(rgb.astype(int) - bg_color).max(axis=2)
    bg_candidate = (color_diff <= color_tolerance) & ~edges
    
    # 3. Flood fill BFS dai bordi
    visited = np.zeros((h, w), dtype=bool)
    queue = deque()
    
    # Seed dagli angoli e bordi
    for y in range(h):
        for x in [0, w-1]:
            if bg_candidate[y, x] and not visited[y, x]:
                queue.append((y, x))
                visited[y, x] = True
    for x in range(w):
        for y in [0, h-1]:
            if bg_candidate[y, x] and not visited[y, x]:
                queue.append((y, x))
                visited[y, x] = True
    
    bg_mask = np.zeros((h, w), dtype=bool)
    while queue:
        y, x = queue.popleft()
        bg_mask[y, x] = True
        for dy, dx in [(-1,0),(1,0),(0,-1),(0,1)]:
            ny, nx = y+dy, x+dx
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx]:
                if bg_candidate[ny, nx]:
                    visited[ny, nx] = True
                    queue.append((ny, nx))
    
    # 4. SAFETY: se rimuoverebbe troppo, annulla
    bg_ratio = bg_mask.sum() / bg_mask.size
    if bg_ratio > 0.88:
        # Probabilmente ha cannibalizzato il prodotto. Annullo.
        return None, None
    if bg_ratio < 0.05:
        # Non ha rimosso quasi nulla. Non vale la pena.
        return None, None
    
    # 5. Costruisco alpha + anti-aliasing leggero
    new_alpha = np.where(bg_mask, 0, 255).astype(np.uint8)
    
    # Smoothing molto lieve solo sui bordi (no blur aggressivo)
    alpha_img = Image.fromarray(new_alpha)
    alpha_img = alpha_img.filter(ImageFilter.GaussianBlur(radius=0.4))
    new_alpha = np.array(alpha_img)
    
    arr[:, :, 3] = new_alpha
    return Image.fromarray(arr, 'RGBA'), bg_mask


def _detect_skin_tone(rgb, subject_mask):
    """
    Rileva pixel con tonalità della pelle (mani umane in foto ambiente).
    Versione v3 stretta: esclude metalli oro/bronzo e cluster sparsi.
    
    Pelle umana tipica vs metallo dorato:
    - Pelle: G/R ratio ~ 0.75-0.85, B/R ratio ~ 0.65-0.80
    - Metallo dorato: G/R simile MA B/R molto più basso (<0.65) o R molto alto (>200)
    
    Aggiunge anche check di CLUSTERING: pelle umana forma macchie connesse grandi,
    riflessi metallici sono sparsi/piccoli.
    """
    if not subject_mask.any():
        return 0.0
    r = rgb[:,:,0].astype(int)
    g = rgb[:,:,1].astype(int)
    b = rgb[:,:,2].astype(int)
    
    # Filtro skin tipico
    skin = (
        (r > 130) & (r < 220) &
        (g > 95) & (g < 175) &
        (b > 70) & (b < 145) &
        (r > g) & (g > b) &
        ((r - g) > 15) & ((r - g) < 50) &
        ((g - b) > 8) & ((g - b) < 40) &
        # Anti-metal: pelle ha rapporto G/R alto (0.70+) e B/R medio (0.55-0.80)
        (g * 100 // np.maximum(r, 1) > 70) &
        (b * 100 // np.maximum(r, 1) > 55) &
        (b * 100 // np.maximum(r, 1) < 80)
    )
    skin_in_subject = skin & subject_mask
    skin_ratio = skin_in_subject.sum() / max(subject_mask.sum(), 1)
    
    if skin_ratio < 0.05:
        return 0.0  # troppo poca, non vale la pena clustering check
    
    # Clustering check: la pelle forma macchie compatte, non sparpaglie
    # Approccio rapido: conto componenti connesse > 100 pixel
    # Senza scipy, uso un BFS leggero su un sub-sample
    from collections import deque
    
    # Subsample 2x per velocità
    skin_small = skin_in_subject[::2, ::2]
    h, w = skin_small.shape
    visited = np.zeros_like(skin_small)
    biggest_cluster_pixels = 0
    
    for sy in range(h):
        for sx in range(w):
            if skin_small[sy, sx] and not visited[sy, sx]:
                # BFS
                queue = deque([(sy, sx)])
                visited[sy, sx] = True
                size = 0
                while queue:
                    y, x = queue.popleft()
                    size += 1
                    for dy, dx in [(-1,0),(1,0),(0,-1),(0,1)]:
                        ny, nx = y+dy, x+dx
                        if 0 <= ny < h and 0 <= nx < w and skin_small[ny, nx] and not visited[ny, nx]:
                            visited[ny, nx] = True
                            queue.append((ny, nx))
                if size > biggest_cluster_pixels:
                    biggest_cluster_pixels = size
                if biggest_cluster_pixels > 500:
                    break  # già abbastanza grande, esco
        if biggest_cluster_pixels > 500:
            break
    
    # Una mano umana forma un cluster compatto di almeno ~500 pixel (subsampled 2x)
    # = 2000 pixel originali
    if biggest_cluster_pixels < 200:
        return 0.0  # pixel sparsi = non è una mano, sono riflessi metallici
    
    return skin_ratio


def _detect_play_button(rgb):
    """
    Detection icona play YouTube (triangolo bianco/grigio su sfondo colorato).
    Versione stretta: serve un cerchio chiaro al centro + sfondo molto colorato.
    """
    h, w = rgb.shape[:2]
    cy, cx = h // 2, w // 2
    
    # Zona centrale ristretta (10% × 10%)
    rh, rw = h // 10, w // 10
    center = rgb[cy-rh:cy+rh, cx-rw:cx+rw]
    if center.size == 0:
        return False
    
    lum = center.mean(axis=2)
    # Pixel molto chiari al centro (>220, non solo >200)
    play_pixels = (lum > 220).sum()
    play_ratio = play_pixels / lum.size
    
    # Il triangolo play occupa tipicamente 25-50% del cerchio
    if not (0.20 < play_ratio < 0.65):
        return False
    
    # Verifico che la zona INTORNO sia significativamente più scura/colorata
    ring_outer_h = h // 4
    ring_outer_w = w // 4
    outer = rgb[max(0,cy-ring_outer_h):cy+ring_outer_h, max(0,cx-ring_outer_w):cx+ring_outer_w]
    if outer.size == 0:
        return False
    outer_lum = outer.mean(axis=2)
    # La luminanza media intorno deve essere significativamente più scura
    inner_lum_mean = lum.mean()
    outer_lum_mean = outer_lum.mean()
    
    if inner_lum_mean - outer_lum_mean < 60:
        return False  # non c'è abbastanza contrasto
    
    # Il ring deve avere alta varianza (sfondo colorato dietro = video)
    ring_std = outer.std()
    if ring_std < 60:
        return False
    
    return True


def _detect_brand_only(rgb, subject_mask, w, h):
    """
    Detection foto brand-only.
    Una foto brand-only ha:
    - Sfondo dominante
    - Testo grande grigio/scuro centrato
    - Pochissima varianza colori
    - Aspect del soggetto orizzontale (testo)
    """
    if not subject_mask.any():
        return False
    
    fg_pixels = rgb[subject_mask]
    if len(fg_pixels) < 100:
        return False
    
    # Brand-only è grigio (poca saturazione)
    fg_r = fg_pixels[:, 0].astype(int)
    fg_g = fg_pixels[:, 1].astype(int)
    fg_b = fg_pixels[:, 2].astype(int)
    max_chan = np.maximum(np.maximum(fg_r, fg_g), fg_b)
    min_chan = np.minimum(np.minimum(fg_r, fg_g), fg_b)
    saturation = (max_chan - min_chan).mean()
    
    color_std = fg_pixels.std(axis=0).mean()
    
    # Bounding box
    rows = np.any(subject_mask, axis=1)
    cols = np.any(subject_mask, axis=0)
    if not rows.any() or not cols.any():
        return False
    rmin, rmax = np.where(rows)[0][[0, -1]]
    cmin, cmax = np.where(cols)[0][[0, -1]]
    bbox_h = rmax - rmin + 1
    bbox_w = cmax - cmin + 1
    bbox_aspect = bbox_w / max(bbox_h, 1)
    
    # Brand-only: bassa saturazione + bassa varianza + soggetto orizzontale + piccolo
    is_low_sat = saturation < 8
    is_low_var = color_std < 30
    is_horizontal = bbox_aspect > 2.5
    is_small = (bbox_h * bbox_w) / (w * h) < 0.35
    is_centered = (rmin > h * 0.15) and (rmax < h * 0.85)
    
    return is_low_sat and is_low_var and is_horizontal and is_small and is_centered


def _get_subject_bbox(alpha):
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
    Analizza foto e ritorna:
        {ok: bool, reason: str, needs_cleaning: bool, mark_for_redownload: bool, stats: dict}
    """
    try:
        img = Image.open(img_path)
    except Exception:
        return {"ok": False, "reason": "cannot_open", "needs_cleaning": False, "mark_for_redownload": False, "stats": {}}
    
    file_size_kb = os.path.getsize(img_path) / 1024
    if file_size_kb < 6:
        return {"ok": False, "reason": "file_too_small", "needs_cleaning": False, "mark_for_redownload": True, "stats": {"kb": round(file_size_kb,1)}}
    
    w, h = img.size
    area = w * h
    
    if area < 35000 or w < 150 or h < 90:
        return {"ok": False, "reason": "img_too_small", "needs_cleaning": False, "mark_for_redownload": True, "stats": {"size": (w,h)}}
    
    aspect = w / h
    if aspect < 0.30 or aspect > 4.0:
        return {"ok": False, "reason": "aspect_extreme", "needs_cleaning": False, "mark_for_redownload": True, "stats": {"aspect": round(aspect,2)}}
    
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
    arr = np.array(img)
    a = arr[:, :, 3]
    rgb = arr[:, :, :3]
    transparent_ratio = (a == 0).sum() / a.size
    
    needs_cleaning = False
    cleaned_img_obj = None
    is_dark_bg = False
    subject_mask = None
    final_alpha = a.copy()
    
    # === CASO A: già pulita ===
    if transparent_ratio > 0.15:
        subject_mask = a > 30
        cleaned_img_obj = img
    
    # === CASO B: opaca ===
    else:
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
        
        # === Detection video thumbnail (preliminare) ===
        if _detect_play_button(rgb):
            return {"ok": False, "reason": "video_thumbnail", "needs_cleaning": False,
                    "mark_for_redownload": True, "stats": {}}
        
        # === Detection foto promo (sfondo saturo: blu acceso, verde, ecc) ===
        bg_color = _sample_bg_color(rgb)
        bg_sat = max(bg_color) - min(bg_color)
        bg_lum = sum(bg_color) / 3
        if bg_sat > 40 and 50 < bg_lum < 200:
            return {"ok": False, "reason": "saturated_promo_background",
                    "needs_cleaning": False, "mark_for_redownload": True,
                    "stats": {"bg_color": list(bg_color), "bg_sat": bg_sat}}
        
        # === Detection foto ambiente più severa ===
        global_std = rgb.std(axis=(0,1)).mean()
        quadrants = [
            rgb[:h//2, :w//2],
            rgb[:h//2, w//2:],
            rgb[h//2:, :w//2],
            rgb[h//2:, w//2:],
        ]
        quad_means = np.array([q.mean(axis=(0,1)) for q in quadrants])
        quad_std = quad_means.std(axis=0).mean()
        
        # Foto ambiente caso 1: nessun angolo uniforme + alta varianza
        if total_solid < 2 and (cross_corner_std > 30 or quad_std > 25):
            return {"ok": False, "reason": "no_solid_bg_likely_environment",
                    "needs_cleaning": False, "mark_for_redownload": True,
                    "stats": {"light": light_corners, "dark": dark_corners,
                              "cc_std": round(cross_corner_std,1), "quad_std": round(quad_std,1)}}
        
        # Foto ambiente caso 2: angoli "chiari" ma NON bianco puro (es. studio grigio chiaro)
        # Se bg_color < 240 ma >180 (grigio chiaro) E global_std > 45 (molta varianza nel content)
        # → probabilmente è foto ambiente su scrivania chiara
        if (180 < bg_lum < 240) and global_std > 45 and bg_sat < 20:
            # Controllo anche cross-corner: se gli angoli stessi sono diversi tra loro
            if cross_corner_std > 12:
                return {"ok": False, "reason": "light_environment_not_pure_white",
                        "needs_cleaning": False, "mark_for_redownload": True,
                        "stats": {"bg_lum": round(bg_lum,1), "global_std": round(global_std,1),
                                  "cc_std": round(cross_corner_std,1)}}
        
        if dark_corners >= 2 and light_corners < 2:
            # Foto su sfondo scuro: controllo se è ambiente scuro complesso
            # Caso 1: bg non quasi-nero puro (>30 luminanza) + global_std alto
            if bg_lum > 30 and global_std > 60:
                return {"ok": False, "reason": "dark_environment_complex_scene",
                        "needs_cleaning": False, "mark_for_redownload": True,
                        "stats": {"bg_lum": round(bg_lum,1), "global_std": round(global_std,1)}}
            # Caso 2: anche se bg quasi nero, se gli angoli sono diversi tra loro = ambiente
            if cross_corner_std > 10 and global_std > 22:
                return {"ok": False, "reason": "dark_environment_complex_scene",
                        "needs_cleaning": False, "mark_for_redownload": True,
                        "stats": {"cc_std": round(cross_corner_std,1), "global_std": round(global_std,1)}}
            
            is_dark_bg = True
            avg_rgb = ((arr[:,:,0].astype(int) + arr[:,:,1].astype(int) + arr[:,:,2].astype(int)) / 3)
            subject_mask = avg_rgb > 40
            cleaned_img_obj = img
        elif light_corners >= 2:
            # === BG REMOVAL SMART (edge-aware) ===
            try:
                cleaned, bg_mask = _remove_bg_smart(img, color_tolerance=8)
                if cleaned is None:
                    # Safety triggered: case bianco rilevato e annullato
                    # Tengo foto opaca così com'è
                    cleaned_img_obj = img
                    subject_mask = np.ones((h, w), dtype=bool)
                else:
                    cleaned_img_obj = cleaned
                    needs_cleaning = True
                    subject_mask = ~bg_mask
                    final_alpha = np.array(cleaned)[:, :, 3]
            except Exception as e:
                return {"ok": False, "reason": "removal_failed",
                        "needs_cleaning": False, "mark_for_redownload": False,
                        "stats": {"err": str(e)[:30]}}
        else:
            # Sfondo uniforme misto
            is_dark_bg = True
            subject_mask = np.ones((h, w), dtype=bool)
            cleaned_img_obj = img
        
        # === Check skin-tone (mani umane in foto) ===
        skin_ratio = _detect_skin_tone(rgb, subject_mask)
        if skin_ratio > 0.06:  # >6% pixel skin = c'è una mano/braccio significativo
            return {"ok": False, "reason": "human_skin_detected",
                    "needs_cleaning": False, "mark_for_redownload": True,
                    "stats": {"skin": round(skin_ratio, 3)}}
        
        # === Detection brand-only ===
        if _detect_brand_only(rgb, subject_mask, w, h):
            return {"ok": False, "reason": "brand_only_text",
                    "needs_cleaning": False, "mark_for_redownload": True,
                    "stats": {}}
    
    # === Validazione soggetto ===
    if subject_mask is None:
        return {"ok": False, "reason": "no_mask", "needs_cleaning": False, "mark_for_redownload": False, "stats": {}}
    
    subject_ratio = subject_mask.sum() / subject_mask.size
    
    if subject_ratio < 0.06:
        return {"ok": False, "reason": "subject_too_small",
                "needs_cleaning": False, "mark_for_redownload": True,
                "stats": {"sub_ratio": round(subject_ratio,2)}}
    
    if transparent_ratio < 0.15 and subject_ratio > 0.97 and area > 100000 and not is_dark_bg:
        return {"ok": False, "reason": "subject_too_large_bad_removal",
                "needs_cleaning": False, "mark_for_redownload": False,
                "stats": {"sub_ratio": round(subject_ratio,2)}}
    
    bbox = _get_subject_bbox(final_alpha)
    if bbox is None:
        return {"ok": False, "reason": "no_subject", "needs_cleaning": False, "mark_for_redownload": False, "stats": {}}
    
    rmin, cmin, rmax, cmax = bbox
    bbox_area = (cmax - cmin + 1) * (rmax - rmin + 1)
    bbox_ratio = bbox_area / area
    
    if bbox_ratio < 0.08:
        return {"ok": False, "reason": "bbox_too_small",
                "needs_cleaning": False, "mark_for_redownload": True,
                "stats": {"bbox": round(bbox_ratio,2)}}
    
    fg_pixels = rgb[subject_mask]
    if len(fg_pixels) < 50:
        return {"ok": False, "reason": "too_few_pixels", "needs_cleaning": False, "mark_for_redownload": False, "stats": {}}
    
    color_std = fg_pixels.std(axis=0).mean()
    fg_mean = fg_pixels.mean()
    
    if color_std < 12 and bbox_ratio < 0.25:
        return {"ok": False, "reason": "monochromatic_brand_only",
                "needs_cleaning": False, "mark_for_redownload": True,
                "stats": {"std": round(color_std,1)}}
    
    if fg_mean > 200 and color_std < 25:
        return {"ok": False, "reason": "very_light_low_variance_brand",
                "needs_cleaning": False, "mark_for_redownload": True,
                "stats": {"mean": round(fg_mean,1)}}
    
    return {
        "ok": True,
        "reason": "good",
        "needs_cleaning": needs_cleaning,
        "mark_for_redownload": False,
        "stats": {
            "sub": round(subject_ratio, 2),
            "bbox": round(bbox_ratio, 2),
            "std": round(color_std, 1),
            "size": (w, h),
            "cleaned_img_obj": cleaned_img_obj,
        }
    }


def clean_photo(img_path):
    """Ripulisce in-place una foto con sfondo bianco (chiamata solo se needs_cleaning=True)."""
    try:
        img = Image.open(img_path).convert('RGBA')
        cleaned, _ = _remove_bg_smart(img, color_tolerance=8)
        if cleaned is None:
            # Safety: il prodotto è anche bianco. Non tocco la foto.
            return False
        cleaned.save(img_path, 'PNG', optimize=True)
        return True
    except Exception as e:
        print(f"  ⚠️  clean_photo failed for {img_path}: {e}")
        return False
