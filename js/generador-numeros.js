/* ========================================================================
   GENERADOR-NUMEROS.JS
   Motor ÚNICO y COMPARTIDO para generar números del Numerólogo. Antes esto
   lo hacía main.py (y guardaba el resultado en Firestore); ahora main.py
   SOLO escalpea resultados oficiales, y este motor corre en el navegador,
   reutilizado por:
     - "Números → Numerólogo" (numeros.js)
     - "Enviar jugada → Cargar tipos" dentro del modal Nueva Jugada (jugadas.js)
     - "Enviar jugada → Generar numerólogo (tendencia)" (jugadas.js)
     - "Enviar jugada → Numerologitos" (jugadas.js)

   TODOS los parámetros de estas 3 últimas estrategias (más "Numerólogo por
   tipo de jugada", que comparten "Números" y "Cargar tipos") se leen de
   Firestore: `sistema_config/generacion_app`. La vista "Configuración"
   (configuracion.js) es la única que los EDITA; el resto del app los usa
   en modo lectura, siempre en tiempo real (onSnapshot), cada una con su
   PROPIA sección de configuración porque cada estrategia funciona distinto.
   ====================================================================== */

const COL_SISTEMA_CONFIG = 'sistema_config';
const DOC_GENERACION_APP = 'generacion_app';

const GEN_ESTRATEGIAS = [
  { id:'descuenta_ultimos_sorteo', label:'Descuenta últimos sorteo' },
  { id:'caliente',                 label:'Número caliente' },
  { id:'frio',                     label:'Número frío' },
  { id:'muerto',                   label:'Número muerto' },
  { id:'mixto',                    label:'Mixto' },
  { id:'mixto_descuenta',          label:'Mixto quitando último sorteo' },
];

/* Valores por defecto de las 3 secciones configurables. Se usan mientras
   llega el primer snapshot de Firestore, y como base para "Restaurar
   valores por defecto" en Configuración. */
const GEN_CONFIG_DEFAULT = {
  // Usado por "Números → Numerólogo" Y por "Enviar jugada → Cargar tipos"
  // (ambos generan por TIPO de jugada: Quiniela/Palé/Tripleta/Ganar 85%,
  // o el tipo único de KINO/LOTOMAS/LOTO_REAL/LOTO_POOL).
  numerologo: {
    estrategias: ['descuenta_ultimos_sorteo'],
    tendencia: true,
    sorteosTendencia: 5,
    exclusion: true,
    exclusionCantidad: 5,
    exclusionPosiciones: [0, 1],
    cantidadGanar85: 30, // 30 a 50
    martingalaActiva: true,
    martingalaNivelMaximo: 4, // 1 a 10
  },
  // "Enviar jugada → Generar numerólogo (tendencia)"
  numerologoTendencia: {
    sorteosTendencia: 3,     // 1 a 15
    cantidadObjetivo: 40,    // 20 a 60
    martingalaActiva: true,
    martingalaNivelMaximo: 4, // 1 a 10
  },
  // "Enviar jugada → Numerologitos"
  numerologitos: {
    sorteosExclusion: 10,    // 1 a 20
    cantidadObjetivo: 20,    // 10 a 40
    martingalaActiva: true,
    martingalaNivelMaximo: 4, // 1 a 10
  },
};

/* Config activa en memoria, actualizada en tiempo real. Arranca en los
   valores por defecto por si algún componente genera antes de que llegue
   el primer snapshot de Firestore. */
let GEN_CONFIG = JSON.parse(JSON.stringify(GEN_CONFIG_DEFAULT));
let GEN_CONFIG_LISTENERS = [];   // callbacks a avisar cuando cambia la config
let GEN_CONFIG_UNSUB = null;

function genMezclarConDefault(datos){
  const base = JSON.parse(JSON.stringify(GEN_CONFIG_DEFAULT));
  return {
    numerologo: { ...base.numerologo, ...(datos?.numerologo || {}) },
    numerologoTendencia: { ...base.numerologoTendencia, ...(datos?.numerologoTendencia || {}) },
    numerologitos: { ...base.numerologitos, ...(datos?.numerologitos || {}) },
  };
}

/* Escucha en tiempo real `sistema_config/generacion_app`. Se puede llamar
   varias veces (cada vista que la necesite) sin problema: solo arma UN
   listener real y despacha a todos los callbacks registrados. */
function genEscucharConfig(callback){
  if(callback) GEN_CONFIG_LISTENERS.push(callback);
  if(GEN_CONFIG_UNSUB) { if(callback) callback(GEN_CONFIG); return; }

  GEN_CONFIG_UNSUB = db.collection(COL_SISTEMA_CONFIG).doc(DOC_GENERACION_APP)
    .onSnapshot(doc=>{
      GEN_CONFIG = genMezclarConDefault(doc.exists ? doc.data() : null);
      GEN_CONFIG_LISTENERS.forEach(cb=>{ try{ cb(GEN_CONFIG); }catch(e){ console.error(e); } });
    }, err=>{
      console.error('[Generación] Error escuchando configuración:', err);
    });
}

/* Guarda (merge) una sección de la configuración. Usado solo desde
   Configuración. Si el documento no existe todavía, lo crea con los
   valores por defecto de las OTRAS secciones para no dejarlas vacías. */
async function genGuardarSeccionConfig(seccion, datos){
  const payload = {};
  payload[seccion] = datos;
  await db.collection(COL_SISTEMA_CONFIG).doc(DOC_GENERACION_APP).set(payload, { merge:true });
}

async function genRestaurarConfigPorDefecto(){
  await db.collection(COL_SISTEMA_CONFIG).doc(DOC_GENERACION_APP).set(GEN_CONFIG_DEFAULT, { merge:false });
}

/* Igual que categoria_loteria() en main.py, para saber si es una lotería
   de un solo tipo especial (kino/lotomas/loto_real/loto_pool) o general. */
function genCategoriaLoteria(nombre){
  const n = (nombre || '').toLowerCase();
  const ALIASES = {
    kino: ['kino', 'kino tv'],
    lotomas: ['lotomas', 'lotomás', 'loto mas', 'loto'],
    loto_real: ['loto real', 'loto-real', 'loto_real', 'lotoreal', 'loto real noche'],
    loto_pool: ['loto pool', 'lotopool', 'loto-pool', 'loto_pool'],
  };
  for(const cat in ALIASES){ if(ALIASES[cat].includes(n)) return cat; }
  return 'general';
}

/* ------------------------------------------------------------------
   HISTORIAL: lee `loterias/{loteria}/resultados` (lo que main.py fue
   escalpeando tal cual) y lo cachea en memoria, ordenado del sorteo más
   antiguo al más reciente (clave para la ponderación por recencia). */
const GEN_HISTORIAL_CACHE = {};
async function genCargarHistorialAsc(loteria){
  if(GEN_HISTORIAL_CACHE[loteria]) return GEN_HISTORIAL_CACHE[loteria];
  const snap = await db.collection('loterias').doc(loteria).collection('resultados').get();
  const filas = [];
  snap.docs.forEach(doc=>{
    const numeros = doc.data().numeros;
    if(Array.isArray(numeros) && numeros.length) filas.push([doc.id, numeros]);
  });
  filas.sort((a,b)=> a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0));
  const historial = filas.map(f=>f[1]);
  GEN_HISTORIAL_CACHE[loteria] = historial;
  return historial;
}
function genLimpiarCacheHistorial(loteria){
  if(loteria) delete GEN_HISTORIAL_CACHE[loteria];
  else Object.keys(GEN_HISTORIAL_CACHE).forEach(k=>delete GEN_HISTORIAL_CACHE[k]);
}

/* ============================================================
   ALGORITMO INTELIGENTE DE PONDERACIÓN (frecuencia ponderada por
   recencia + atraso + consistencia) — equivalente al que usaba main.py.
   ============================================================ */
function genCalcularPuntuaciones(historial){
  if(!historial.length) return {};
  const total = historial.length;
  const contadorPonderado = {}, aparicionesPorNumero = {}, ultimaPosicion = {};
  historial.forEach((dia, i)=>{
    const pesoRecencia = 1 + (i / Math.max(total - 1, 1)) * 3;
    new Set(dia).forEach(num=>{
      contadorPonderado[num] = (contadorPonderado[num] || 0) + pesoRecencia;
      aparicionesPorNumero[num] = (aparicionesPorNumero[num] || 0) + 1;
      ultimaPosicion[num] = i;
    });
  });
  const todos = new Set();
  historial.forEach(dia=>dia.forEach(n=>todos.add(n)));
  const puntuaciones = {};
  todos.forEach(num=>{
    const score = contadorPonderado[num] || 0;
    const sorteosDesdeUltima = total - 1 - (ultimaPosicion[num] ?? (total - 1));
    const bonoAtraso = sorteosDesdeUltima * 0.18;
    const consistencia = (aparicionesPorNumero[num] || 0) / total;
    const bonoConsistencia = consistencia * 1.5;
    puntuaciones[num] = score + bonoAtraso + bonoConsistencia;
  });
  return puntuaciones;
}

function genBarajar(arr){
  for(let j = arr.length - 1; j > 0; j--){
    const r = Math.floor(Math.random() * (j + 1));
    [arr[j], arr[r]] = [arr[r], arr[j]];
  }
  return arr;
}

function genMuestreoPonderado(itemsPesos, k){
  let items = itemsPesos.slice();
  const seleccionados = [];
  k = Math.min(k, items.length);
  for(let i = 0; i < k; i++){
    const pesoTotal = items.reduce((s, it)=>s + it[1], 0);
    if(pesoTotal <= 0){
      genBarajar(items);
      items.slice(0, k - seleccionados.length).forEach(it=>seleccionados.push(it[0]));
      break;
    }
    const r = Math.random() * pesoTotal;
    let acumulado = 0;
    for(let idx = 0; idx < items.length; idx++){
      acumulado += items[idx][1];
      if(acumulado >= r){ seleccionados.push(items[idx][0]); items.splice(idx, 1); break; }
    }
  }
  return seleccionados;
}

function genCalcularPoolInteligente(historial, topNMax){
  const puntuaciones = genCalcularPuntuaciones(historial);
  const entradas = Object.entries(puntuaciones).map(([n, p])=>[Number(n), p]);
  if(!entradas.length) return [];
  entradas.sort((a, b)=> b[1] - a[1]);
  const universo = entradas.slice(0, Math.max(topNMax * 2, topNMax + 5));
  return genMuestreoPonderado(universo, topNMax);
}
function genObtenerNumerosFrecuentes(historial, topN){
  return genCalcularPoolInteligente(historial, topN).slice().sort((a,b)=>a-b);
}

function genUniversoDesdeHistorial(historial, universoFijo){
  if(universoFijo) return universoFijo.slice();
  const todos = new Set();
  historial.forEach(dia=>dia.forEach(n=>todos.add(n)));
  if(!todos.size) return Array.from({length:100}, (_,i)=>i);
  const arr = [...todos];
  const min = Math.min(...arr), max = Math.max(...arr);
  const out = [];
  for(let n = min; n <= max; n++) out.push(n);
  return out;
}

function genPoolCaliente(historial, cantidad){ return genCalcularPoolInteligente(historial, cantidad); }

function genPoolFrio(historial, cantidad){
  const puntuaciones = genCalcularPuntuaciones(historial);
  const entradas = Object.entries(puntuaciones).map(([n, p])=>[Number(n), p]);
  if(!entradas.length) return [];
  entradas.sort((a, b)=> a[1] - b[1]);
  const universoCandidatos = entradas.slice(0, Math.max(cantidad * 2, cantidad + 5));
  const pesosInvertidos = universoCandidatos.map(([n, score])=>[n, 1 / (score + 0.5)]);
  return genMuestreoPonderado(pesosInvertidos, cantidad);
}

function genPoolMuerto(historial, cantidad, universo){
  const universoFinal = genUniversoDesdeHistorial(historial, universo);
  const frecuencia = {};
  historial.forEach(dia=>dia.forEach(n=>frecuencia[n] = (frecuencia[n]||0) + 1));
  let nuncaSalieron = genBarajar(universoFinal.filter(n=>!frecuencia[n]));
  let seleccion = nuncaSalieron.slice(0, cantidad);
  if(seleccion.length < cantidad){
    const faltan = cantidad - seleccion.length;
    for(const n of genPoolFrio(historial, faltan + seleccion.length + 5)){
      if(!seleccion.includes(n)) seleccion.push(n);
      if(seleccion.length >= cantidad) break;
    }
  }
  return seleccion.slice(0, cantidad);
}

function genPoolMixto(historial, cantidad, universo){
  const mitadCaliente = Math.floor(cantidad / 2);
  const mitadFria = cantidad - mitadCaliente;
  let seleccion = [];
  for(const n of genPoolCaliente(historial, mitadCaliente + 5)){
    if(!seleccion.includes(n)) seleccion.push(n);
    if(seleccion.length >= mitadCaliente) break;
  }
  for(const n of genPoolFrio(historial, mitadFria + 5)){
    if(!seleccion.includes(n)) seleccion.push(n);
    if(seleccion.length >= cantidad) break;
  }
  if(seleccion.length < cantidad){
    const universoFinal = genBarajar(genUniversoDesdeHistorial(historial, universo));
    for(const n of universoFinal){
      if(!seleccion.includes(n)) seleccion.push(n);
      if(seleccion.length >= cantidad) break;
    }
  }
  return seleccion.slice(0, cantidad);
}

function genPoolMixtoDescuenta(historial, cantidad, universo, sorteosExclusion, posiciones){
  const recientes = historial.length > sorteosExclusion ? historial.slice(-sorteosExclusion) : historial.slice();
  const excluidos = new Set();
  recientes.forEach(dia=>{
    (posiciones || [0,1]).forEach(idx=>{ if(dia.length > idx) excluidos.add(dia[idx]); });
  });
  const historialFiltrado = historial.map(dia=>dia.filter(n=>!excluidos.has(n)));
  return genPoolMixto(historialFiltrado, cantidad, universo);
}

function genGenerarPoolPorEstrategia(historial, estrategia, cantidad, universo, sorteosExclusion, posiciones){
  if(!historial.length) return [];
  if(estrategia === 'caliente') return genPoolCaliente(historial, cantidad);
  if(estrategia === 'frio') return genPoolFrio(historial, cantidad);
  if(estrategia === 'muerto') return genPoolMuerto(historial, cantidad, universo);
  if(estrategia === 'mixto') return genPoolMixto(historial, cantidad, universo);
  if(estrategia === 'mixto_descuenta') return genPoolMixtoDescuenta(historial, cantidad, universo, sorteosExclusion, posiciones);
  return genPoolCaliente(historial, cantidad);
}

/* ============================================================
   TENDENCIA / LADO GANADOR (alto/bajo)
   ============================================================ */
const GEN_UNIVERSO_BAJO = Array.from({length:49}, (_,i)=>i+1);              // 1..49
const GEN_UNIVERSO_ALTO = Array.from({length:50}, (_,i)=>i+50).concat([0]); // 50..99 y el 0 (=100)

function genLadoDe(n){ if(n === 0) return 'alto'; return n >= 50 ? 'alto' : 'bajo'; }

function genDeterminarLadoGanador(historial, dias){
  const recientes = historial.length > dias ? historial.slice(-dias) : historial.slice();
  const primeros = recientes.filter(d=>d.length).map(d=>d[0]);
  if(!primeros.length) return 'alto';
  const altos = primeros.filter(n=>genLadoDe(n) === 'alto').length;
  const bajos = primeros.length - altos;
  return altos >= bajos ? 'alto' : 'bajo';
}

/* Exclusión dinámica del lado ganador: recorre los sorteos más recientes
   (hasta `maxSorteos` hacia atrás) tomando, sorteo por sorteo, las
   posiciones elegidas (1ra/2da/3ra), y va excluyendo del universo del
   lado ganador cada número que aparezca ahí — hasta juntar exactamente
   (universo.length - total) exclusiones, o hasta agotar `maxSorteos`. */
function genExcluirRecientesDelLado(historial, universo, total, posiciones, maxSorteos){
  const objetivo = Math.max(0, universo.length - total);
  const universoSet = new Set(universo);
  const excluidos = new Set();
  const historialRev = historial.slice().reverse();
  let sorteosRevisados = 0;
  for(const dia of historialRev){
    if(excluidos.size >= objetivo || sorteosRevisados >= maxSorteos) break;
    sorteosRevisados++;
    for(const idx of posiciones){
      if(excluidos.size >= objetivo) break;
      if(dia.length > idx && universoSet.has(dia[idx]) && !excluidos.has(dia[idx])) excluidos.add(dia[idx]);
    }
  }
  return excluidos;
}

function genConstruirPoolTotal(historial, lado, total, posiciones, maxSorteos){
  const universo = lado === 'alto' ? GEN_UNIVERSO_ALTO : GEN_UNIVERSO_BAJO;
  const excluidos = genExcluirRecientesDelLado(historial, universo, total, posiciones, maxSorteos);
  const poolRestante = universo.filter(n=>!excluidos.has(n));
  const frecuencia = {};
  historial.forEach(dia=>dia.forEach(n=>frecuencia[n] = (frecuencia[n]||0) + 1));
  poolRestante.sort((a,b)=>(frecuencia[b]||0) - (frecuencia[a]||0));
  return poolRestante;
}

/* ============================================================
   COMBINAR VARIAS ESTRATEGIAS SELECCIONADAS EN UN SOLO POOL
   Cada estrategia MARCADA aporta su propia parte del pool final
   (basePoolSize repartido en partes iguales entre las estrategias
   seleccionadas), en vez de ir alternando número a número entre todas
   ("por turno"). Así el resultado refleja de verdad a cada filtro
   elegido —con su propio bloque de números dentro del pool— y no una
   mezcla intercalada donde un filtro le "roba" turnos a otro.
   ============================================================ */
function genCombinarEstrategias(historial, estrategias, basePoolSize, opts){
  const { tendencia, sorteosTendencia, exclusion, exclusionCantidad, exclusionPosiciones, universoBase } = opts;

  let lado = null;
  if(tendencia || estrategias.includes('descuenta_ultimos_sorteo')){
    lado = genDeterminarLadoGanador(historial, sorteosTendencia);
  }
  const universoEstrategia = (tendencia && lado) ? (lado === 'alto' ? GEN_UNIVERSO_ALTO : GEN_UNIVERSO_BAJO) : universoBase;

  const poolsPorEstrategia = estrategias.map(est=>{
    if(est === 'descuenta_ultimos_sorteo'){
      const posiciones = exclusion ? exclusionPosiciones : [0,1];
      const maxSorteos = exclusion ? exclusionCantidad : 999;
      return genConstruirPoolTotal(historial, lado, basePoolSize, posiciones, maxSorteos);
    }
    if(est === 'mixto_descuenta'){
      const cant = exclusion ? exclusionCantidad : 5;
      const posiciones = exclusion ? exclusionPosiciones : [0,1];
      return genGenerarPoolPorEstrategia(historial, est, basePoolSize, universoEstrategia, cant, posiciones);
    }
    return genGenerarPoolPorEstrategia(historial, est, basePoolSize, universoEstrategia);
  });

  // Reparto por partes iguales: cada estrategia seleccionada llena su
  // propio cupo (los primeros cupos, si sobran unidades por la división,
  // se le dan a las primeras estrategias elegidas).
  const combinado = [];
  const vistos = new Set();
  const n = poolsPorEstrategia.length;
  const cupoBase = Math.floor(basePoolSize / n);
  let sobrante = basePoolSize % n;

  poolsPorEstrategia.forEach(pool=>{
    const cupo = cupoBase + (sobrante > 0 ? 1 : 0);
    if(sobrante > 0) sobrante--;
    let tomados = 0;
    for(const num of pool){
      if(tomados >= cupo || combinado.length >= basePoolSize) break;
      if(vistos.has(num)) continue;
      vistos.add(num); combinado.push(num); tomados++;
    }
  });

  // Si alguna estrategia se quedó corta con su cupo (pool chico o muchos
  // duplicados entre estrategias), se completa primero con lo que sobre
  // de las mismas pools ya calculadas...
  if(combinado.length < basePoolSize){
    for(const pool of poolsPorEstrategia){
      for(const num of pool){
        if(combinado.length >= basePoolSize) break;
        if(!vistos.has(num)){ vistos.add(num); combinado.push(num); }
      }
      if(combinado.length >= basePoolSize) break;
    }
  }

  // Y si aún falta, con el resto del universo (barajado), igual que antes.
  if(combinado.length < basePoolSize){
    const restante = genBarajar(genUniversoDesdeHistorial(historial, universoEstrategia).filter(n=>!vistos.has(n)));
    for(const n of restante){
      combinado.push(n);
      if(combinado.length >= basePoolSize) break;
    }
  }

  return { pool: combinado, lado };
}

/* ============================================================
   LOTOMAS — caso especial (6 números base + "Más" + "Súper Más")
   ============================================================ */
function genGenerarLotomas(historial, cantidadLoto, estrategias, opts){
  const primerosSeis = historial.filter(s=>s.length >= 6).map(s=>s.slice(0,6));
  const planos = primerosSeis.flat();
  const pseudoHistorial = [planos]; // un solo "día" con todos los números juntos

  const { pool } = genCombinarEstrategias(pseudoHistorial, estrategias, cantidadLoto, {
    ...opts, tendencia:false, universoBase: genUniversoDesdeHistorial(pseudoHistorial, null),
  });
  const loto = pool.slice(0, cantidadLoto).sort((a,b)=>a-b);

  const septimos = historial.filter(s=>s.length >= 7).map(s=>s[6]);
  const octavos = historial.filter(s=>s.length >= 8).map(s=>s[7]);
  const masFrecuente = arr=>{
    if(!arr.length) return null;
    const cont = {};
    arr.forEach(n=>cont[n]=(cont[n]||0)+1);
    return Number(Object.entries(cont).sort((a,b)=>b[1]-a[1])[0][0]);
  };
  const mas = masFrecuente(septimos);
  const superMas = masFrecuente(octavos);

  return (mas !== null && superMas !== null) ? [...loto, mas, superMas] : loto;
}

/* ============================================================
   FUNCIÓN PRINCIPAL: genera los números de UN tipo de jugada de UNA
   lotería, usando la sección "numerologo" de la configuración. La usan
   tanto "Números → Numerólogo" como "Enviar jugada → Cargar tipos".
   ============================================================ */
async function genNumerosParaTipo(loteria, tipo, cantidadGanar85Override){
  const historial = await genCargarHistorialAsc(loteria);
  if(!historial.length) return { numeros:[], lado:null, sinHistorial:true };

  const cfg = GEN_CONFIG.numerologo;
  const cat = genCategoriaLoteria(loteria);
  const esUnica = cat !== 'general';

  if(cat === 'lotomas'){
    const cantidad = NUM_CANTIDAD_DEFAULT['LOTOMAS'] || 6;
    const numeros = genGenerarLotomas(historial, cantidad, cfg.estrategias, {
      exclusion: cfg.exclusion, exclusionCantidad: cfg.exclusionCantidad, exclusionPosiciones: cfg.exclusionPosiciones,
    }).sort((a,b)=>a-b);
    return { numeros, lado:null, sinHistorial:false };
  }

  if(cat === 'kino' || cat === 'loto_real' || cat === 'loto_pool'){
    const cantidad = NUM_CANTIDAD_DEFAULT[cat === 'kino' ? 'KINO' : (cat === 'loto_real' ? 'LOTO_REAL' : 'LOTO_POOL')];
    const universoBase = genUniversoDesdeHistorial(historial, null);
    const { pool } = genCombinarEstrategias(historial, cfg.estrategias, cantidad, {
      tendencia:false, sorteosTendencia: cfg.sorteosTendencia, exclusion:false,
      exclusionCantidad: cfg.exclusionCantidad, exclusionPosiciones: cfg.exclusionPosiciones, universoBase,
    });
    return { numeros: pool.slice(0, cantidad).sort((a,b)=>a-b), lado:null, sinHistorial:false };
  }

  // Loterías generales (quinielas): un pool "base" (Ganar 85% seguro) del
  // que se derivan de forma coherente Tripleta/Palé/Quiniela.
  const cantidadGanar85 = cantidadGanar85Override || cfg.cantidadGanar85 || 30;
  const basePoolSize = tipo === 'GANAR 85% SEGURO' ? cantidadGanar85 : Math.max(cantidadGanar85, NUM_CANTIDAD_DEFAULT[tipo] || 1);
  const universoBase = Array.from({length:100}, (_,i)=>i);
  const { pool, lado } = genCombinarEstrategias(historial, cfg.estrategias, basePoolSize, {
    tendencia: cfg.tendencia, sorteosTendencia: cfg.sorteosTendencia, exclusion: cfg.exclusion,
    exclusionCantidad: cfg.exclusionCantidad, exclusionPosiciones: cfg.exclusionPosiciones, universoBase,
  });
  const cantidadFinal = tipo === 'GANAR 85% SEGURO' ? basePoolSize : (NUM_CANTIDAD_DEFAULT[tipo] || 1);
  return { numeros: pool.slice(0, cantidadFinal).sort((a,b)=>a-b), lado, sinHistorial:false };
}

/* Cantidades por defecto de cada tipo de jugada. */
const NUM_CANTIDAD_DEFAULT = {
  'QUINIELA': 1,
  'PALE': 2,
  'TRIPLETAS': 3,
  'GANAR 85% SEGURO': 30,
  'KINO': 10,
  'LOTO_REAL': 6,
  'LOTO_POOL': 5,
  'LOTOMAS': 6,
};

// Arranca el listener en tiempo real en cuanto carga este script, para que
// GEN_CONFIG ya esté actualizado (no solo con los valores por defecto)
// desde el primer momento en que cualquier vista lo necesite.
genEscucharConfig();
