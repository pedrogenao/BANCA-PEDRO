/* ========================================================================
   GENERADOR-NUMEROS.JS
   Motor ÚNICO y COMPARTIDO para generar números del Numerólogo.
   ...
   🆕 Ahora respeta un "rango histórico" configurable (todo el historial,
   últimos 3/2/1 meses, últimos 15 días) guardado en cada sección de
   GEN_CONFIG (rangoHistorico). Depende de recortarHistorialPorRango()
   (definida en utils.js/loterias.js, ver mensaje anterior).
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

const GEN_CONFIG_DEFAULT = {
  numerologo: {
    estrategias: ['descuenta_ultimos_sorteo'],
    tendencia: true,
    sorteosTendencia: 5,
    exclusion: true,
    exclusionCantidad: 5,
    exclusionPosiciones: [0, 1],
    cantidadGanar85: 30,
    martingalaActiva: true,
    martingalaNivelMaximo: 4,
    rangoHistorico: 'todo', // 🆕 'todo' | '3m' | '2m' | '1m' | '15d'
  },
  numerologoTendencia: {
    sorteosTendencia: 3,
    cantidadObjetivo: 40,
    martingalaActiva: true,
    martingalaNivelMaximo: 4,
    rangoHistorico: 'todo', // 🆕
  },
  numerologitos: {
    sorteosExclusion: 10,
    cantidadObjetivo: 20,
    martingalaActiva: true,
    martingalaNivelMaximo: 4,
    rangoHistorico: 'todo', // 🆕
  },
};

let GEN_CONFIG = JSON.parse(JSON.stringify(GEN_CONFIG_DEFAULT));
let GEN_CONFIG_LISTENERS = [];
let GEN_CONFIG_UNSUB = null;

function genMezclarConDefault(datos){
  const base = JSON.parse(JSON.stringify(GEN_CONFIG_DEFAULT));
  return {
    numerologo: { ...base.numerologo, ...(datos?.numerologo || {}) },
    numerologoTendencia: { ...base.numerologoTendencia, ...(datos?.numerologoTendencia || {}) },
    numerologitos: { ...base.numerologitos, ...(datos?.numerologitos || {}) },
  };
}

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

async function genGuardarSeccionConfig(seccion, datos){
  const payload = {};
  payload[seccion] = datos;
  await db.collection(COL_SISTEMA_CONFIG).doc(DOC_GENERACION_APP).set(payload, { merge:true });
}

async function genRestaurarConfigPorDefecto(){
  await db.collection(COL_SISTEMA_CONFIG).doc(DOC_GENERACION_APP).set(GEN_CONFIG_DEFAULT, { merge:false });
}

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
   🆕 HISTORIAL CON FECHAS: esta es ahora la fuente de verdad. Se
   cachea CON fecha para poder recortar por rango histórico. La versión
   "solo números" (genCargarHistorialAsc) se mantiene por compatibilidad
   con quien ya la use, pero internamente deriva de esta. */
const GEN_HISTORIAL_FECHAS_CACHE = {};
async function genCargarHistorialConFechasAsc(loteria){
  if(GEN_HISTORIAL_FECHAS_CACHE[loteria]) return GEN_HISTORIAL_FECHAS_CACHE[loteria];
  const snap = await db.collection('loterias').doc(loteria).collection('resultados').get();
  const filas = [];
  snap.docs.forEach(doc=>{
    const numeros = doc.data().numeros;
    if(Array.isArray(numeros) && numeros.length) filas.push({ fecha: doc.id, numeros });
  });
  filas.sort((a,b)=> a.fecha < b.fecha ? -1 : (a.fecha > b.fecha ? 1 : 0));
  GEN_HISTORIAL_FECHAS_CACHE[loteria] = filas;
  return filas;
}
async function genCargarHistorialAsc(loteria){
  const conFechas = await genCargarHistorialConFechasAsc(loteria);
  return conFechas.map(f=>f.numeros);
}
function genLimpiarCacheHistorial(loteria){
  if(loteria){ delete GEN_HISTORIAL_FECHAS_CACHE[loteria]; }
  else { Object.keys(GEN_HISTORIAL_FECHAS_CACHE).forEach(k=>delete GEN_HISTORIAL_FECHAS_CACHE[k]); }
}

/* ============================================================
   ALGORITMO INTELIGENTE DE PONDERACIÓN — SIN CAMBIOS
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
   TENDENCIA / LADO GANADOR — SIN CAMBIOS
   ============================================================ */
const GEN_UNIVERSO_BAJO = Array.from({length:49}, (_,i)=>i+1);
const GEN_UNIVERSO_ALTO = Array.from({length:50}, (_,i)=>i+50).concat([0]);

function genLadoDe(n){ if(n === 0) return 'alto'; return n >= 50 ? 'alto' : 'bajo'; }

function genDeterminarLadoGanador(historial, dias){
  const recientes = historial.length > dias ? historial.slice(-dias) : historial.slice();
  const primeros = recientes.filter(d=>d.length).map(d=>d[0]);
  if(!primeros.length) return 'alto';
  const altos = primeros.filter(n=>genLadoDe(n) === 'alto').length;
  const bajos = primeros.length - altos;
  return altos >= bajos ? 'alto' : 'bajo';
}

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

  if(combinado.length < basePoolSize){
    for(const pool of poolsPorEstrategia){
      for(const num of pool){
        if(combinado.length >= basePoolSize) break;
        if(!vistos.has(num)){ vistos.add(num); combinado.push(num); }
      }
      if(combinado.length >= basePoolSize) break;
    }
  }

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
   LOTOMAS — SIN CAMBIOS
   ============================================================ */
function genGenerarLotomas(historial, cantidadLoto, estrategias, opts){
  const primerosSeis = historial.filter(s=>s.length >= 6).map(s=>s.slice(0,6));
  const planos = primerosSeis.flat();
  const pseudoHistorial = [planos];

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
   🆕 FUNCIÓN PRINCIPAL — ahora recorta el historial según
   cfg.rangoHistorico ANTES de generar cualquier pool. Todo lo demás
   (kino, lotomas, loto_real/pool, quinielas) sigue exactamente igual,
   solo que trabaja sobre `historial` ya recortado en vez del completo.
   ============================================================ */
async function genNumerosParaTipo(loteria, tipo, cantidadGanar85Override){
  const historialConFechas = await genCargarHistorialConFechasAsc(loteria);
  if(!historialConFechas.length) return { numeros:[], lado:null, sinHistorial:true };

  const cfg = GEN_CONFIG.numerologo;

  // 🆕 Recorte por rango histórico configurado (todo/3m/2m/1m/15d).
  // recortarHistorialPorRango() viene de utils.js/loterias.js.
  const historialRecortadoConFechas = (typeof recortarHistorialPorRango === 'function')
    ? recortarHistorialPorRango(historialConFechas, cfg.rangoHistorico, null)
    : historialConFechas;
  const historial = historialRecortadoConFechas.map(f=>f.numeros);

  if(!historial.length) return { numeros:[], lado:null, sinHistorial:true };

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

genEscucharConfig();
