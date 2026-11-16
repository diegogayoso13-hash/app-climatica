# Genera los iconos PNG de la app (sin librerias externas).
# Fondo azul con una flecha de viento blanca y una ola celeste.
import math, struct, sys, zlib

def png(path, size):
    azul, blanco, celeste = (11, 61, 99), (255, 255, 255), (120, 200, 240)
    s = size
    filas = []
    for y in range(s):
        fila = bytearray([0])
        for x in range(s):
            u, v = x / s, y / s
            c = azul
            # flecha apuntando arriba-derecha (zona central, dentro del area segura del icono adaptable)
            px, py = u - 0.5, v - 0.45
            a = math.radians(45)
            rx = px * math.cos(a) + py * math.sin(a)
            ry = -px * math.sin(a) + py * math.cos(a)
            if -0.18 < ry < 0.06 and abs(rx) < 0.045:
                c = blanco
            if -0.30 < ry <= -0.16 and abs(rx) < (ry + 0.30) * 0.85:
                c = blanco
            # ola
            ola = 0.70 + 0.035 * math.sin(u * 2 * math.pi * 2)
            if ola < v < ola + 0.06 and 0.18 < u < 0.82:
                c = celeste
            fila += bytes(c)
        filas.append(bytes(fila))
    datos = zlib.compress(b"".join(filas), 9)
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", s, s, 8, 2, 0, 0, 0)))
        f.write(chunk(b"IDAT", datos))
        f.write(chunk(b"IEND", b""))

carpeta = sys.argv[1]
for n in (192, 512):
    png(f"{carpeta}/icono-{n}.png", n)
print("ok")
