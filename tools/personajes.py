"""
Prepara las piezas de personajes de Astra (lote 2) para el juego.

Cada pieza llega en un lienzo completo de 836 × 1254. Aquí se recorta a lo que ocupa, se reduce
a una cuarta parte (suficiente para el tamaño en pantalla) y se guarda en WebP. El manifiesto
anota, por vista, dónde va cada pieza (en unidades del lienzo, con el origen en los pies) y el
orden de dibujo, para que el esqueleto del juego las anime sin recalcular nada.

Uso: python3 tools/personajes.py <cuerpos> <ropas_v01> <ropa_v02_tejedor> <cabezas> <salida>
"""
import json, os, sys
from PIL import Image

ESCALA = 0.25
ORIGEN = (418, round(1254 * 0.92))  # mismo origen que RIG_ORIGIN en shared/src/rig.ts
VISTAS = ['front', 'side', 'back']
TESTIGOS = {'cuello', 'mano_L', 'mano_R', '__cabeza_testigo'}

def pieza(src, dst_rel, salida):
    im = Image.open(src).convert('RGBA')
    bb = im.getchannel('A').point(lambda v: 255 if v > 3 else 0).getbbox()
    if not bb: return None
    x0, y0, x1, y1 = max(0, bb[0] - 3), max(0, bb[1] - 3), min(im.width, bb[2] + 3), min(im.height, bb[3] + 3)
    rec = im.crop((x0, y0, x1, y1))
    w, h = max(1, round(rec.width * ESCALA)), max(1, round(rec.height * ESCALA))
    rec = rec.resize((w, h), Image.LANCZOS)
    out = os.path.join(salida, dst_rel)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    rec.save(out, 'WEBP', quality=90, method=6)
    return {'f': dst_rel.replace(os.sep, '/'), 'x': x0 - ORIGEN[0], 'y': y0 - ORIGEN[1], 'w': x1 - x0, 'h': y1 - y0}

def carpeta(base, rel_salida, salida, omitir=()):
    res = {}
    for f in sorted(os.listdir(base)):
        if not f.endswith('.png') or f[:-4] in omitir: continue
        p = pieza(os.path.join(base, f), os.path.join(rel_salida, f[:-4] + '.webp'), salida)
        if p: res[f[:-4]] = p
    return res

def main(cuerpos, ropas, tejedor_v02, cabezas, salida):
    os.makedirs(salida, exist_ok=True)
    rig = json.load(open(os.path.join(cuerpos, 'medio', 'rig_medio.json')))
    man = {'escala': ESCALA, 'rig': {v: {k: [p[0] - ORIGEN[0], p[1] - ORIGEN[1]] for k, p in rig['views'][v].items()} for v in VISTAS},
           'cuerpo': {}, 'ropas': {}, 'cabezas': {}}
    for v in VISTAS:
        man['cuerpo'][v] = carpeta(os.path.join(cuerpos, 'medio', v), f'cuerpo/{v}', salida)
    for ropa in sorted(os.listdir(ropas)):
        d = os.path.join(ropas, ropa)
        if not os.path.isdir(d): continue
        man['ropas'][ropa] = {}
        for v in VISTAS:
            if ropa == 'vaerel_tejedor' and tejedor_v02:
                base = os.path.join(tejedor_v02, v)  # v02: uniones mejoradas
            else:
                base = os.path.join(d, v)
            capas = json.load(open(os.path.join(base, 'capas.json')))
            orden = capas.get('orden_completo_QA') or capas['orden_de_dibujo']
            if 'cuello' not in orden: orden = ['cuello'] + orden
            for m in ('mano_L', 'mano_R'):
                if m not in orden: orden.insert(orden.index(m.replace('mano', 'antebrazo')) + 1, m)
            if '__cabeza_testigo' not in orden: orden.append('__cabeza_testigo')
            orden = ['cabeza' if o == '__cabeza_testigo' else o for o in orden]
            man['ropas'][ropa][v] = {'orden': orden, 'piezas': carpeta(base, f'ropas/{ropa}/{v}', salida, TESTIGOS)}
    for cab in sorted(os.listdir(cabezas)):
        d = os.path.join(cabezas, cab)
        if not os.path.isdir(d): continue
        man['cabezas'][cab] = {v: carpeta(os.path.join(d, v), f'cabezas/{cab}/{v}', salida) for v in VISTAS}
    json.dump(man, open(os.path.join(salida, 'manifest.json'), 'w'), ensure_ascii=False, separators=(',', ':'))

if __name__ == '__main__':
    main(*sys.argv[1:6])
