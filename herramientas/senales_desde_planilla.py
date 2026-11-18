# Arma docs/senales.json para el mapa a partir de la planilla de senales de la CARP.
# La planilla es INTERNA: NUNCA se copia al proyecto ni se sube a git. Este script solo lee
# 6 columnas autorizadas (km, tipo, color/lado, latitud, longitud y destello) y nada mas.
#
# Uso:  python herramientas/senales_desde_planilla.py "<ruta a la planilla .xlsx>" docs/senales.json
# Necesita openpyxl (pip install openpyxl).
import sys, re, json, openpyxl

COL = {"km": 2, "t1": 3, "t2": 4, "t3": 5, "lat": 7, "lon": 8, "destello": 11}  # columnas de la hoja (0 = A)
num = re.compile(r"\d+(?:[.,]\d+)?")

def coord(txt):
    """Grados, minutos y segundos (formatos mezclados) -> decimal. S y W negativos."""
    s = str(txt or "").strip()
    p = [float(x.replace(",", ".")) for x in num.findall(s)]
    if len(p) < 2: return None
    g, m, sg = p[0], p[1], (p[2] if len(p) > 2 else 0)
    if m >= 60 or sg >= 60: return None
    v = g + m / 60 + sg / 3600
    return -v if re.search(r"[SWO]\s*$", s.upper()) else v

def tipo_y_color(t1, t2, t3):
    t1, t2, t3 = (str(x or "").strip() for x in (t1, t2, t3))
    if t1 == "Baliza": return "Baliza", ""
    if t2.startswith("Lat"):
        lado = "roja" if "Roja" in (t2 + t3) else "verde"
        return "Lateral", lado + (" (CPB)" if "CPB" in t3 else "")
    if t2 == "Cardinal": return "Cardinal", t3.lower()
    if t2 == "Peligro": return "Peligro aislado", ""
    return (t2 or t1), t3.lower()

if __name__ == "__main__":
    ws = openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=True).worksheets[0]
    out = []
    for f in ws.iter_rows(min_row=8, values_only=True):
        g = lambda k: f[COL[k]] if COL[k] < len(f) else None
        m = num.search(str(g("km") or ""))
        lat, lon = coord(g("lat")), coord(g("lon"))
        if not m or lat is None or lon is None: continue  # filas sin km o sin posicion (p. ej. el resumen del final)
        tipo, color = tipo_y_color(g("t1"), g("t2"), g("t3"))
        out.append([float(m.group(0).replace(",", ".")), tipo, color, round(lat, 6), round(lon, 6), str(g("destello") or "").strip()])
    out.sort(key=lambda r: (r[0], r[1], r[2]))
    json.dump({"campos": ["km", "tipo", "color", "lat", "lon", "destello"], "fuente": "CARP, planilla de señales (solo estas 6 columnas)",
               "senales": out}, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("señales:", len(out))
