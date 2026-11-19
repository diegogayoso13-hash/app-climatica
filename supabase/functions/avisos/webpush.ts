// Envio de notificaciones web (Web Push) solo con WebCrypto, sin librerias de terceros.
// Cifrado: RFC 8291 (aes128gcm, RFC 8188). Identificacion del servidor: VAPID (RFC 8292, firma ES256).
// Funciones puras salvo enviarPush (que hace el fetch): se prueban en la compu contra el ejemplo del RFC 8291.

const te = new TextEncoder();
export const b64u = {
  enc: (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: (s: string) => { const t = s.replace(/-/g, "+").replace(/_/g, "/"); const p = atob(t + "===".slice((t.length + 3) % 4)); return Uint8Array.from(p, (c) => c.charCodeAt(0)); },
};
const unir = (...ps: Uint8Array[]) => { const o = new Uint8Array(ps.reduce((s, p) => s + p.length, 0)); let i = 0; for (const p of ps) { o.set(p, i); i += p.length; } return o; };

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, largo: number) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, largo * 8));
}
// Clave publica sin comprimir (65 bytes) -> JWK
const jwkPublica = (pub: Uint8Array) => ({ kty: "EC", crv: "P-256", x: b64u.enc(pub.slice(1, 33)), y: b64u.enc(pub.slice(33, 65)), ext: true });

/** Cifra el mensaje para un navegador. Para la prueba del RFC se pueden fijar sal y clave del emisor. */
export async function cifrar(texto: string, p256dh: string, auth: string, fijo?: { sal: Uint8Array; emisorPrivada: string; emisorPublica: string }) {
  const uaPub = b64u.dec(p256dh), secreto = b64u.dec(auth);
  if (uaPub.length !== 65 || uaPub[0] !== 4) throw new Error("clave del navegador inválida");
  if (secreto.length !== 16) throw new Error("secreto del navegador inválido");
  let asPriv: CryptoKey, asPub: Uint8Array;
  if (fijo) {
    asPub = b64u.dec(fijo.emisorPublica);
    asPriv = await crypto.subtle.importKey("jwk", { ...jwkPublica(asPub), d: fijo.emisorPrivada }, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  } else {
    const par = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
    asPriv = par.privateKey; asPub = new Uint8Array(await crypto.subtle.exportKey("raw", par.publicKey));
  }
  // Valida que la clave del navegador este en la curva (si no, importKey falla).
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const compartido = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPriv, 256));
  const ikm = await hkdf(secreto, compartido, unir(te.encode("WebPush: info\0"), uaPub, asPub), 32);
  const sal = fijo?.sal ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(sal, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(sal, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const claro = unir(te.encode(texto), new Uint8Array([2])); // 0x02 = ultimo registro
  const k = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, k, claro));
  const rs = new Uint8Array([0, 0, 16, 0]); // tamaño de registro 4096
  return unir(sal, rs, new Uint8Array([65]), asPub, cifrado);
}

/** Encabezado VAPID: firma (ES256) que identifica a nuestro servidor ante el servicio de notificaciones. */
export async function vapid(endpoint: string, publica: string, privada: string, sujeto: string, ahora = Date.now()) {
  const aud = new URL(endpoint).origin;
  const cab = b64u.enc(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const cuerpo = b64u.enc(te.encode(JSON.stringify({ aud, exp: Math.floor(ahora / 1000) + 12 * 3600, sub: sujeto })));
  const clave = await crypto.subtle.importKey("jwk", { ...jwkPublica(b64u.dec(publica)), d: privada }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, clave, te.encode(`${cab}.${cuerpo}`)));
  return `vapid t=${cab}.${cuerpo}.${b64u.enc(firma)}, k=${publica}`;
}

export type Resultado = { ok: boolean; baja: boolean; estado: number; detalle?: string };
/** Manda un aviso. baja = el navegador ya no existe (desinstalado o sin permiso): hay que borrarlo. */
export async function enviarPush(sub: { endpoint: string; p256dh: string; auth: string }, mensaje: unknown,
  claves: { publica: string; privada: string; sujeto: string }, ttlSeg = 3600, urgencia = "high"): Promise<Resultado> {
  const cuerpo = await cifrar(JSON.stringify(mensaje), sub.p256dh, sub.auth);
  const r = await fetch(sub.endpoint, {
    method: "POST",
    headers: { Authorization: await vapid(sub.endpoint, claves.publica, claves.privada, claves.sujeto), "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream", TTL: String(ttlSeg), Urgency: urgencia },
    body: cuerpo, signal: AbortSignal.timeout(15000),
  });
  const detalle = r.ok ? undefined : (await r.text().catch(() => "")).slice(0, 200);
  return { ok: r.ok, baja: r.status === 404 || r.status === 410, estado: r.status, detalle };
}

// Servicios de notificaciones conocidos: el registro solo acepta direcciones de estos (nunca una direccion cualquiera).
export const SERVICIOS_PUSH = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /^web\.push\.apple\.com$/, /\.push\.apple\.com$/];
export const servicioValido = (endpoint: string) => {
  try { const u = new URL(endpoint); return u.protocol === "https:" && SERVICIOS_PUSH.some((r) => r.test(u.hostname)); } catch { return false; }
};
