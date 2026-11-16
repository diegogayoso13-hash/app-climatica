// Lector de los "Avisos Vigentes a las 13hs" del SOHMA.
// Recibe el texto del PDF ya separado en paginas y renglones, y devuelve solo lo que
// afecta al Canal Martin Garcia. No inventa nada: si algo no se pudo leer, lo informa.

export type Config = {
  kmDesde: number;
  kmHasta: number;
  incluirIntermedio: boolean;
};

export type Radioaviso = {
  avur: string;
  titulo: string;
  texto: string;
  emitido: string | null; // "16/11/2026"
  vigenteHasta: string | null; // ISO
  anula: string | null;
  pagina: number;
};

export type Baliza = {
  senal: string; // "4010"
  tramo: string; // "BARRA DEL FARALLON"
  km: number | null;
  tipo: string; // "BOYA KM 40.5 LATERAL ESTRIBOR"
  estado: string; // "APAGADA"
  detalle: string; // renglon completo
  pagina: number;
};

export type Resultado = {
  radioavisos: Radioaviso[];
  balizas: Baliza[];
  listaBalizamiento: { avur: string | null; emitido: string | null; vigenteHasta: string | null } | null;
  encabezadoCanalEncontrado: boolean;
  problemas: string[];
};

// Mayusculas sin acentos, para comparar.
export const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

const MESES: Record<string, number> = { ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8, SEP: 9, SET: 9, OCT: 10, NOV: 11, DIC: 12 };

// "282359 P NOV.26" -> 28/11/2026 23:59 hora P (UTC-3)
export function vigencia(s: string): string | null {
  const m = norm(s).match(/(\d{2})(\d{2})(\d{2})\s*P\s*([A-Z]{3})\.?\s*(\d{2})/);
  if (!m || !MESES[m[4]]) return null;
  const [, dd, hh, mi, mes, aa] = m;
  const f = `20${aa}-${String(MESES[mes]).padStart(2, "0")}-${dd}T${hh}:${mi}:00-03:00`;
  return Number.isNaN(Date.parse(f)) ? null : new Date(f).toISOString();
}

// Tramos unicos del canal (segun tabla de la CARP). Los genericos necesitan "MARTIN GARCIA" al lado.
const TRAMOS_UNICOS = ["BARRA DEL FARALLON", "PASO DEL FARALLON", "BARRA DE SAN PEDRO", "PASO DE SAN JUAN", "POZOS DE SAN JUAN", "CANAL DEL INFIERNO"];

export function radioavisoDelCanal(textoNorm: string, cfg: Config): boolean {
  if (textoNorm.includes("MARTIN GARCIA")) return true;
  if (TRAMOS_UNICOS.some((t) => textoNorm.includes(t))) return true;
  if (cfg.incluirIntermedio && textoNorm.includes("CANAL INTERMEDIO")) return true;
  return false;
}

const ESTADOS = ["FALTA", "APAGADA", "AVERIADA", "CORRIDA", "RETIRADA", "LUZ NO CONFIABLE", "AIS FUERA DE SERVICIO", "REPOSICIONADA", "DESTRUIDA", "HUNDIDA", "SIN MARCA DE TOPE"];

export function leerEstado(lineaNorm: string): string {
  const encontrados = ESTADOS.filter((e) => lineaNorm.includes(e === "FALTA" ? "FALTA" : e));
  if (encontrados.length) return encontrados.join(" Y ");
  // si no reconoce el estado, lo que viene despues de la ultima coma
  const partes = lineaNorm.replace(/\.$/, "").split(",");
  return partes.length > 1 ? partes[partes.length - 1].trim() : "SIN ESTADO RECONOCIDO";
}

const RE_SENAL = /^N\s*[º°O]\s*(\d{3,5}(?:\.\d+)?)\s*-\s*(.+)$/;

export function analizar(paginas: string[][], cfg: Config): Resultado {
  const res: Resultado = { radioavisos: [], balizas: [], listaBalizamiento: null, encabezadoCanalEncontrado: false, problemas: [] };

  // La seccion 2 (novedades de balizamiento) empieza en la pagina que dice "SECCION 2".
  let inicioSec2 = paginas.findIndex((p) => p.some((l) => norm(l) === "SECCION 2"));
  if (inicioSec2 < 0) {
    res.problemas.push("No encontré el comienzo de la Sección 2 (balizamiento).");
    inicioSec2 = paginas.length;
  }

  // ---- Seccion 1: radioavisos (uno por pagina) ----
  for (let i = 0; i < inicioSec2; i++) {
    const lineas = paginas[i];
    const todo = lineas.join("\n");
    const tn = norm(todo);
    const mAvur = tn.match(/AVUR N[º°O]?\s*:?\s*(\d{4}\.\d{2})/);
    if (!mAvur) continue;
    if (!radioavisoDelCanal(tn, cfg)) continue;
    // Orden de la pagina: ... "AVUR Nº: 0888.26", zona, tema, texto..., "ANULA", "Vigente Hasta", "Montevideo, fecha".
    const idxAvur = lineas.findIndex((l) => /AVUR N/.test(norm(l)));
    const resto: string[] = [];
    for (let j = idxAvur + 1; j < lineas.length; j++) {
      const ln = norm(lineas[j]);
      if (/^(ANULA|CODIGOS USO INTERNO|VIGENTE HASTA|MONTEVIDEO,|INFORMACION ACTUALIZADA)/.test(ln)) break;
      if (ln) resto.push(lineas[j].trim());
    }
    // Zona y tema son los renglones cortos del principio; el resto es el texto del aviso.
    const titulo: string[] = [];
    while (resto.length > 1 && titulo.length < 2 && resto[0].length <= 45) titulo.push(resto.shift()!);
    const cuerpo = resto;
    const mVig = tn.match(/VIGENTE HASTA\s+(\d{6}\s*P\s*[A-Z]{3}\.?\s*\d{2})/);
    const mEmi = todo.match(/(\d{2}\/\d{2}\/\d{4})\s*,?\s*Montevideo|Montevideo,?\s*(\d{2}\/\d{2}\/\d{4})/i);
    const mAnula = tn.match(/ANULA AVISO\s*N?[º°O]?\s*(\d{4}\.\d{2})/);
    res.radioavisos.push({
      avur: mAvur[1],
      titulo: titulo.join(" · "),
      texto: cuerpo.join(" ").replace(/\s+/g, " "),
      emitido: mEmi ? (mEmi[1] ?? mEmi[2]) : null,
      vigenteHasta: mVig ? vigencia(mVig[1]) : null,
      anula: mAnula ? mAnula[1] : null,
      pagina: i + 1,
    });
  }

  // ---- Seccion 2: balizamiento ----
  // Cada AVUR de balizamiento es un "bloque"; guardamos emision y vigencia del bloque que trae el canal.
  type Bloque = { avur: string | null; emitido: string | null; vigenteHasta: string | null; tieneCanal: boolean };
  let bloque: Bloque = { avur: null, emitido: null, vigenteHasta: null, tieneCanal: false };
  const cerrarBloque = () => { if (bloque.tieneCanal && !res.listaBalizamiento) res.listaBalizamiento = { avur: bloque.avur, emitido: bloque.emitido, vigenteHasta: bloque.vigenteHasta }; };
  let tramo: string | null = null;
  for (let i = inicioSec2; i < paginas.length; i++) {
    const lineas = paginas[i];
    const tn = norm(lineas.join("\n"));
    // Pagina "sucia": el texto viene duplicado (AVVUR, MMONTEVIDEEO, KKM) y los numeros salen mal.
    // En castellano casi ninguna palabra empieza con dos letras iguales (salvo LL).
    const dobles = (tn.match(/\b([A-KM-Z])\1/g) ?? []).length;
    if (dobles >= 5) {
      const menciona = /MARTIN GARCIA|FARAL+ON|BARRA DE SAN PEDRO|PASO DE SAN JUAN|POZOS DE SAN JUAN|CANAL DEL INFIERNO|CANAL INTERMEDIO/.test(tn.replace(/([A-Z])\1/g, "$1"));
      res.problemas.push(`Página ${i + 1} del PDF salió con el texto duplicado y no se usa${menciona ? ": PARECE MENCIONAR EL CANAL, revisar el PDF a mano" : " (no parece ser del canal)"}.`);
      cerrarBloque();
      bloque = { avur: null, emitido: null, vigenteHasta: null, tieneCanal: false };
      continue;
    }

    for (const l of lineas) {
      const ln = norm(l);
      if (!ln) continue;
      const mAv = ln.match(/^AVUR N[º°O]?\s*:?\s*(\d{4}\.\d{2})$/);
      if (mAv) {
        cerrarBloque();
        bloque = { avur: mAv[1], emitido: null, vigenteHasta: null, tieneCanal: false };
        tramo = null;
        continue;
      }
      const mVig = ln.match(/VIGENTE HASTA\s+(\d{6}\s*P\s*[A-Z]{3}\.?\s*\d{2})/);
      if (mVig) bloque.vigenteHasta = vigencia(mVig[1]);
      const mEmi = l.match(/Montevideo,?\s*(\d{2}\/\d{2}\/\d{4})/i);
      if (mEmi) bloque.emitido = mEmi[1];

      const s = ln.match(RE_SENAL);
      if (!s) {
        // Encabezado de tramo: renglon en mayusculas sin numero de senal
        if (/^[A-Z][A-Z .\-–"”“()ºª]+$/.test(ln) && ln.length > 4) {
          if (ln.startsWith("CANALES A MARTIN GARCIA")) {
            tramo = ln.replace(/^CANALES A MARTIN GARCIA\s*[-–]?\s*/, "") || "CANALES A MARTIN GARCIA";
            res.encabezadoCanalEncontrado = true;
            bloque.tieneCanal = true;
          } else if (cfg.incluirIntermedio && ln === "CANAL INTERMEDIO") {
            tramo = "CANAL INTERMEDIO";
            bloque.tieneCanal = true;
          } else if (!/^(ANULA|VIGENTE|MONTEVIDEO|CODIGOS|INFORMACION|NOVEDAD)/.test(ln)) {
            tramo = null;
          }
        }
        continue;
      }
      if (!tramo) continue;
      const kmM = s[2].match(/KM\s*(\d+(?:[.,]\d+)?)/);
      const km = kmM ? Number(kmM[1].replace(",", ".")) : null;
      const esIntermedio = tramo === "CANAL INTERMEDIO";
      if (!esIntermedio && km != null && (km < cfg.kmDesde || km > cfg.kmHasta)) {
        res.problemas.push(`Señal Nº ${s[1]} (${tramo}) en km ${km}, fuera del rango ${cfg.kmDesde}–${cfg.kmHasta}: no se muestra.`);
        continue;
      }
      const tipo = s[2].split(",")[0].trim();
      res.balizas.push({ senal: s[1], tramo, km, tipo, estado: leerEstado(s[2]), detalle: l.trim(), pagina: i + 1 });
    }
  }
  cerrarBloque();
  if (!res.encabezadoCanalEncontrado) res.problemas.push("No encontré el encabezado \"CANALES A MARTÍN GARCÍA\" en el balizamiento.");
  return res;
}
