// Arma los renglones de cada pagina a partir de los pedazos de texto que da pdf.js,
// agrupandolos por altura (y) y ordenandolos de izquierda a derecha (x).
// deno-lint-ignore no-explicit-any
export async function renglonesPorPagina(pdf: any): Promise<string[][]> {
  const paginas: string[][] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const tc = await page.getTextContent();
    const items = (tc.items as { str: string; transform: number[]; width: number }[])
      .filter((it) => typeof it.str === "string" && it.str.length)
      .map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width }));
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lineas: { y: number; partes: typeof items }[] = [];
    for (const it of items) {
      const l = lineas.find((L) => Math.abs(L.y - it.y) < 2.5);
      if (l) l.partes.push(it); else lineas.push({ y: it.y, partes: [it] });
    }
    lineas.sort((a, b) => b.y - a.y);
    paginas.push(lineas.map((L) => {
      L.partes.sort((a, b) => a.x - b.x);
      let txt = "", finAnt = -Infinity;
      for (const p of L.partes) {
        if (txt && p.x - finAnt > 1.5 && !txt.endsWith(" ") && !p.s.startsWith(" ")) txt += " ";
        txt += p.s;
        finAnt = p.x + p.w;
      }
      return txt.replace(/\s+/g, " ").trim();
    }).filter(Boolean));
    page.cleanup?.();
  }
  return paginas;
}
