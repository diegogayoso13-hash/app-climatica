# Calcula las componentes de marea astronomica de cada estacion de la CARP (analisis armonico
# por minimos cuadrados) y escribe el SQL para cargarlas en la tabla public.armonicos.
#
# Uso:  python herramientas/armonicos.py <carpeta con los CSV de la CARP> <salida.sql>
# Los CSV salen de los zip "*_tide.zip" de https://www.comisionriodelaplata.org/servicios_main.php?sid=BT
# Hora de los CSV: Uruguay (UTC-3), verificado contra las lecturas del robot. Alturas en m, cero LIMB.
#
# Cada componente se guarda como  a*cos(w*x) + b*sin(w*x), con x = horas desde 2020-01-01 00:00 hora UY
# (= 2020-01-01 03:00 UTC). La app suma todo y le agrega la media (componente Z0).
import sys, os, math, datetime as dt

# Velocidades angulares (grados por hora) de las componentes usadas.
V = {"M2": 28.9841042, "S2": 30.0, "N2": 28.4397295, "K2": 30.0821373, "K1": 15.0410686, "O1": 13.9430356, "P1": 14.9589314,
     "Q1": 13.3986609, "M4": 57.9682084, "MS4": 58.9841042, "MN4": 57.4238337, "M6": 86.9523127, "2N2": 27.8953548,
     "MU2": 27.9682084, "NU2": 28.5125831, "L2": 29.5284789, "M3": 43.4761563, "MK3": 44.0251729, "2MK3": 42.9271398,
     "S4": 60.0, "M8": 115.9364166, "MM": 0.5443747, "MSF": 1.0158958, "MF": 1.0980331, "SA": 0.0410686, "SSA": 0.0821373}
T0 = dt.datetime(2020, 1, 1)
# Año de ajuste por estacion: el ultimo con buena cobertura (Carmelo casi no tiene 2022-2025).
AJUSTE = {"norden": ("Norden", 2025), "colonia": ("Colonia", 2025), "conchillas": ("Conchillas", 2025), "carmelo": ("Carmelo", 2021)}

def leer(carpeta, nombre, anio):
    h = {}
    with open(os.path.join(carpeta, f"{nombre}_tide_{anio}.csv")) as f:
        next(f)
        for l in f:
            p = l.strip().split(",")
            try: t = dt.datetime.strptime(p[0], "%Y-%m-%d %H:%M:%S"); v = float(p[1])
            except (ValueError, IndexError): continue
            if t.minute == 0: h[t] = v  # una lectura por hora alcanza
    return h

def fila(x):
    r = [1.0]
    for w in V.values(): a = math.radians(w * x); r += [math.cos(a), math.sin(a)]
    return r

def resolver(A, b):
    n = len(A); M = [A[i][:] + [b[i]] for i in range(n)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(M[r][c])); M[c], M[p] = M[p], M[c]
        for r in range(n):
            if r != c:
                f = M[r][c] / M[c][c]
                for k in range(c, n + 1): M[r][k] -= f * M[c][k]
    return [M[i][n] / M[i][i] for i in range(n)]

def ajustar(datos):
    n = 1 + 2 * len(V); A = [[0.0] * n for _ in range(n)]; b = [0.0] * n
    for t, v in datos.items():
        r = fila((t - T0).total_seconds() / 3600)
        for i in range(n):
            b[i] += r[i] * v; ri = r[i]; Ai = A[i]
            for j in range(n): Ai[j] += ri * r[j]
    return resolver(A, b)

if __name__ == "__main__":
    carpeta, salida = sys.argv[1], sys.argv[2]
    filas, controles = [], []
    for est, (nombre, anio) in AJUSTE.items():
        datos = leer(carpeta, nombre, anio)
        c = ajustar(datos)
        desde, hasta = min(datos), max(datos)
        filas.append(f"('{est}','Z0',0,{c[0]!r},0,'{desde:%Y-%m-%d}','{hasta:%Y-%m-%d}',{len(datos)})")
        for i, (k, w) in enumerate(V.items()):
            filas.append(f"('{est}','{k}',{w!r},{c[1 + 2 * i]!r},{c[2 + 2 * i]!r},'{desde:%Y-%m-%d}','{hasta:%Y-%m-%d}',{len(datos)})")
        # Valores de control (para comprobar que la app calcula lo mismo): 2026-11-17 12:00 y 18:00 hora UY.
        for t in (dt.datetime(2026, 11, 17, 12), dt.datetime(2026, 11, 17, 18)):
            x = (t - T0).total_seconds() / 3600
            controles.append((est, t.isoformat() + "-03:00", round(sum(a * b for a, b in zip(c, fila(x))), 4)))
        print(f"{est}: ajuste {anio}, {len(datos)} horas, media {c[0]:.3f} m")
    with open(salida, "w", encoding="utf-8") as f:
        f.write("delete from public.armonicos;\ninsert into public.armonicos (estacion, componente, velocidad_gh, coef_cos, coef_sin, ajuste_desde, ajuste_hasta, horas) values\n")
        f.write(",\n".join(filas) + ";\n")
    print("CONTROLES", controles)
