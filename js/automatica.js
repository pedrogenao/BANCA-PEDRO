/* ========================================================================
   AUTOMATICA.JS
   "Enviar jugada" → estrategia AUTOMÁTICA.

   Flujo:
     1) El admin elige estrategia (Cargar tipos / Generar numerólogo
        (tendencia) / Numerologitos), tipo de jugada y rango hacia atrás
        (por defecto los últimos 10 días).
     2) Se testean con la SIMULACIÓN (simCorrerPura, simulacion.js — mismo
        motor, misma martingala, sin mirar el futuro) TODAS las loterías de
        más de una jugada, cada una con esa estrategia.
     3) Se muestran 4 grupos:
          • Más rentables            (terminaron en ganancia neta)
          • Más perdedoras           (terminaron en pérdida neta)
          • Niveles de martingala más altos — ganadoras
          • Niveles de martingala más altos — perdedoras
     4) El admin elige UN grupo. Desde ahí "Enviar jugada" sigue igual que
        siempre, pero solo con las loterías de ese grupo y generando los
        números automáticamente con la estrategia con la que se testeó.
   ====================================================================== */

// id de estrategia en la simulación → id de estrategia "en vivo" (GEN_CONFIG / martingala)
const AUTO_ESTRATEGIA_VIVO = { numerologo:'numerologo', tendencia:'numerologoTendencia', numerologitos:'numerologitos' };
const AUTO_ESTRATEGIA_NOMBRE = { numerologo:'Cargar tipos (Numerólogo)', tendencia:'Generar numerólogo (tendencia)', numerologitos:'Numerologitos' };
const AUTO_TIPO_NOMBRE = { 'QUINIELA':'Quiniela', 'PALE':'Palé', 'TRIPLETAS':'Tripleta', 'GANAR 85% SEGURO':'Ganar 85%' };

const AUTO_GRUPOS = [
  { id:'rentables',           titulo:'Más rentables',                             desc:'Terminaron el rango en ganancia neta (de más a menos).' },
  { id:'perdedoras',          titulo:'Más perdedoras',                            desc:'Terminaron el rango en pérdida neta (de más a menos).' },
  { id:'nivelGanadoras',      titulo:'Niveles de martingala más altos — ganadoras', desc:'Llegaron a niveles altos de martingala y aun así terminaron en ganancia.' },
  { id:'nivelPerdedoras',     titulo:'Niveles de martingala más altos — perdedoras', desc:'Llegaron a niveles altos de martingala y terminaron en pérdida: vienen perdiendo desde atrás.' },
];

let AUTO_SEL_ESTRATEGIA = 'numerologo';
let AUTO_SEL_TIPO = 'QUINIELA';
let AUTO_RESULTADOS = null;   // { grupos:{id:[filas]}, estrategia, tipo, dias }
let AUTO_TESTEANDO = false;
let AUTO_SELECCION = new Set();   // loterías marcadas dentro del grupo elegido
let AUTO_NUMEROS_CACHE = new Map(); // `${loteria}|${fecha}|...` → números generados
let AUTO_MONTO_OVERRIDE = {};    // `${loteria}|${usuario}` → monto editado a mano
let AUTO_PLAN = null;
let AUTO_PLAN_TOKEN = 0;

/* ---------------- chips ---------------- */
document.getElementById('njAutoEstrategiaChips')?.addEventListener('click', (e)=>{
  const chip = e.target.closest('.filter-tab'); if(!chip) return;
  document.querySelectorAll('#njAutoEstrategiaChips .filter-tab').forEach(c=>c.classList.remove('active'));
  chip.classList.add('active');
  AUTO_SEL_ESTRATEGIA = chip.dataset.estrategia;
});
document.getElementById('njAutoTipoChips')?.addEventListener('click', (e)=>{
  const chip = e.target.closest('.filter-tab'); if(!chip) return;
  document.querySelectorAll('#njAutoTipoChips .filter-tab').forEach(c=>c.classList.remove('active'));
  chip.classList.add('active');
  AUTO_SEL_TIPO = chip.dataset.tipo;
});

document.getElementById('btnAutoNJ')?.addEventListener('click', ()=>{
  const box = document.getElementById('njAutoBox');
  box.style.display = box.style.display === 'none' ? '' : 'none';
});
document.getElementById('btnAutoSalirNJ')?.addEventListener('click', ()=>autoSalirNJ(false));

/* ---------------- utilidades ---------------- */
function autoFechaHaceDias(dias){
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
const autoPausa = ()=> new Promise(r=>setTimeout(r,0));

function autoConfigMartingala(estrategiaSim){
  const cfg = GEN_CONFIG[AUTO_ESTRATEGIA_VIVO[estrategiaSim]] || {};
  const activa = cfg.martingalaActiva !== false;
  const nivelMaximo = activa ? Math.min(10, Math.max(1, cfg.martingalaNivelMaximo || NIVEL_MAXIMO_MARTINGALA)) : 1;
  return { activa, nivelMaximo };
}

/* ---------------- 1) TESTEO de todas las loterías ---------------- */
async function autoTestearTodas(){
  if(!esAdmin() || AUTO_TESTEANDO) return;
  const btn = document.getElementById('btnAutoTestear');
  const estadoEl = document.getElementById('njAutoEstado');
  const gruposEl = document.getElementById('njAutoGrupos');

  const estrategia = AUTO_SEL_ESTRATEGIA;
  const tipo = AUTO_SEL_TIPO;
  const dias = Math.min(90, Math.max(3, Number(document.getElementById('njAutoDias').value) || 10));
  const montoBase = Math.min(100, Math.max(1, Number(document.getElementById('njAutoMontoBase').value) || 5));
  const { activa, nivelMaximo } = autoConfigMartingala(estrategia);
  const cantidadGanar85 = GEN_CONFIG.numerologo.cantidadGanar85 || 30;
  const hoy = hoyStr();
  const fechaPartida = autoFechaHaceDias(dias);

  const loterias = filtrarLoteriasPorTipo(listaLoteriasOrdenadas(), 'multiple')
    .filter(l => {
      const tipos = CATALOGO_LOTERIAS[l]?.tipos;
      return !(tipos && tipos.length) || tipos.includes(tipo);
    });
  if(loterias.length === 0){ estadoEl.textContent = 'No hay loterías de más de una jugada para testear.'; return; }

  AUTO_TESTEANDO = true;
  btn.disabled = true;
  gruposEl.innerHTML = '';
  const filas = [];
  let sinDatos = 0;

  try{
    for(let i=0; i<loterias.length; i++){
      const loteria = loterias[i];
      estadoEl.textContent = `Testeando ${loteria} (${i+1}/${loterias.length})...`;
      await autoPausa(); // deja respirar la pantalla entre loterías
      try{
        const historialCompleto = await simCargarHistorialConFechas(loteria);
        const diasARecorrer = historialCompleto.filter(d => d.fecha >= fechaPartida && d.fecha <= hoy);
        if(diasARecorrer.length === 0){ sinDatos++; continue; }
        const sim = simCorrerPura({
          historialCompleto, diasARecorrer, estrategia, tipo, cantidadGanar85,
          martingalaActiva: activa, nivelMaximo, montoBase,
          inversion: 1e9, // sin límite de banca: se compara el resultado puro de cada lotería
        });
        if(sim.sorteosJugados === 0){ sinDatos++; continue; }
        filas.push({
          loteria, neta: sim.saldo - sim.inversion, maxNivel: sim.maxNivelAlcanzado,
          rachaActual: sim.rachaActual, sorteos: sim.sorteosJugados, perdidaMaxima: sim.perdidaMaxima,
        });
      }catch(err){
        console.error('Automática: error testeando', loteria, err);
        sinDatos++;
      }
    }

    const porNetaDesc = (a,b)=> b.neta - a.neta;
    const porNetaAsc  = (a,b)=> a.neta - b.neta;
    const porNivel = (desempate)=> (a,b)=> (b.maxNivel - a.maxNivel) || (b.rachaActual - a.rachaActual) || desempate(a,b);
    const grupos = {
      rentables:       filas.filter(f=>f.neta > 0).sort(porNetaDesc),
      perdedoras:      filas.filter(f=>f.neta < 0).sort(porNetaAsc),
      nivelGanadoras:  filas.filter(f=>f.neta > 0 && f.maxNivel >= 2).sort(porNivel(porNetaDesc)),
      nivelPerdedoras: filas.filter(f=>f.neta < 0 && f.maxNivel >= 2).sort(porNivel(porNetaAsc)),
    };
    AUTO_RESULTADOS = { grupos, estrategia, tipo, dias, montoBase, activa, nivelMaximo, hoy, fechaPartida };
    estadoEl.textContent = `Listo — ${filas.length} lotería(s) testeada(s) del ${fechaPartida} al ${hoy}${sinDatos ? `, ${sinDatos} sin sorteos/historial en ese rango` : ''}.`;
    autoRenderGrupos();
  }catch(err){
    console.error('Automática:', err);
    estadoEl.textContent = 'Error al testear: ' + err.message;
    toast('Error al testear las loterías.', 'danger');
  }finally{
    AUTO_TESTEANDO = false;
    btn.disabled = false;
  }
}
document.getElementById('btnAutoTestear')?.addEventListener('click', autoTestearTodas);

/* ---------------- 2) RENDER de los 4 grupos ---------------- */
function autoFechaSorteo(){ return document.getElementById('njFecha').value; }
function autoLoteriaYaEnviada(loteria){
  const fecha = autoFechaSorteo();
  if(!fecha) return false;
  return JUGADAS.some(j => j.loteria === loteria && j.fecha === fecha && j.estado !== 'rechazada');
}

function autoRenderGrupos(){
  const cont = document.getElementById('njAutoGrupos');
  if(!AUTO_RESULTADOS){ cont.innerHTML = ''; return; }
  const { grupos, estrategia } = AUTO_RESULTADOS;
  const infoMart = AUTO_RESULTADOS.activa ? `martingala hasta Nivel ${AUTO_RESULTADOS.nivelMaximo}` : 'martingala desactivada';
  cont.innerHTML = `<div class="small-muted" style="margin-bottom:8px;">${AUTO_ESTRATEGIA_NOMBRE[estrategia]} · ${AUTO_TIPO_NOMBRE[AUTO_RESULTADOS.tipo] || AUTO_RESULTADOS.tipo} · últimos ${AUTO_RESULTADOS.dias} días · ${infoMart}. Elige un grupo y luego marca cuáles loterías jugar:</div>` +
    AUTO_GRUPOS.map(g=>{
      const lista = grupos[g.id];
      const elegido = NJ_AUTO.activo && NJ_AUTO.grupo === g.id;
      const filasHTML = lista.length
        ? lista.map(f=>{
            const enviada = elegido && autoLoteriaYaEnviada(f.loteria);
            const chk = elegido
              ? `<input type="checkbox" class="auto-chk" data-loteria="${f.loteria}" ${AUTO_SELECCION.has(f.loteria)?'checked':''} ${enviada?'disabled':''} style="margin-right:8px;" />`
              : '';
            return `
            <label class="auto-grupo-fila" style="${elegido && !enviada ? 'cursor:pointer;' : ''}${enviada ? 'opacity:.5;' : ''}">
              <span class="n">${chk}${f.loteria}${enviada ? ' <span class="small-muted">(ya enviada para esta fecha)</span>' : ''}</span>
              <span class="m"><span class="${f.neta>=0?'auto-pos':'auto-neg'}">${fmtMoneySigned(f.neta)}</span> · Nivel máx ${f.maxNivel} · racha ${f.rachaActual}</span>
            </label>`;
          }).join('')
        : '<div class="small-muted" style="padding:4px 0;">Ninguna lotería cumple esta condición.</div>';
      const barra = elegido && lista.length ? `
          <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-top:8px;">
            <button type="button" class="btn btn-outline btn-sm" id="btnAutoSelTodas">Marcar todas</button>
            <button type="button" class="btn btn-outline btn-sm" id="btnAutoSelNinguna">Desmarcar todas</button>
            <span class="small-muted" id="autoContadorSel">${AUTO_SELECCION.size} seleccionada${AUTO_SELECCION.size===1?'':'s'}</span>
          </div>` : '';
      return `
        <div class="auto-grupo${elegido?' elegido':''}">
          <div class="auto-grupo-head">
            <div>
              <div class="auto-grupo-titulo">${g.titulo} <span class="small-muted">(${lista.length})</span></div>
              <div class="auto-grupo-desc">${g.desc}</div>
            </div>
            <button type="button" class="btn ${elegido?'btn-success':'btn-primary'} btn-sm" data-grupo="${g.id}" ${lista.length?'':'disabled'}>${elegido?'✓ Grupo elegido':'Elegir este grupo'}</button>
          </div>
          <div class="auto-grupo-lista">${filasHTML}</div>
          ${barra}
        </div>`;
    }).join('') +
    '<div class="hint" style="margin:0;">"Racha" = pérdidas seguidas activas al final del rango (la próxima apuesta iría un nivel más arriba). El test usa el mismo motor que Simulación, sin mirar resultados futuros.</div>';
}

document.getElementById('njAutoGrupos')?.addEventListener('click', (e)=>{
  const b = e.target.closest('button[data-grupo]');
  if(b && !b.disabled){ autoElegirGrupo(b.dataset.grupo); return; }
  if(e.target.id === 'btnAutoSelTodas'){
    const lista = AUTO_RESULTADOS?.grupos[NJ_AUTO.grupo] || [];
    lista.forEach(f=>{ if(!autoLoteriaYaEnviada(f.loteria)) AUTO_SELECCION.add(f.loteria); });
    autoRenderGrupos(); autoRefrescarPlan(); return;
  }
  if(e.target.id === 'btnAutoSelNinguna'){
    AUTO_SELECCION.clear();
    autoRenderGrupos(); autoRefrescarPlan(); return;
  }
});
document.getElementById('njAutoGrupos')?.addEventListener('change', (e)=>{
  if(!e.target.classList.contains('auto-chk')) return;
  const l = e.target.dataset.loteria;
  if(e.target.checked) AUTO_SELECCION.add(l); else AUTO_SELECCION.delete(l);
  const c = document.getElementById('autoContadorSel');
  if(c) c.textContent = `${AUTO_SELECCION.size} seleccionada${AUTO_SELECCION.size===1?'':'s'}`;
  autoRefrescarPlan();
});

/* ---------------- 3) ELEGIR grupo → marcar cuáles loterías jugar ---------------- */
function autoElegirGrupo(grupoId){
  if(!AUTO_RESULTADOS) return;
  const lista = AUTO_RESULTADOS.grupos[grupoId] || [];
  if(lista.length === 0){ toast('Ese grupo no tiene loterías.', 'danger'); return; }
  const g = AUTO_GRUPOS.find(x=>x.id===grupoId);

  NJ_AUTO = {
    activo:true,
    estrategia: AUTO_ESTRATEGIA_VIVO[AUTO_RESULTADOS.estrategia],
    estrategiaSim: AUTO_RESULTADOS.estrategia,
    tipo: AUTO_RESULTADOS.tipo,
    grupo: grupoId,
    loterias: new Set(lista.map(f=>f.loteria)),
  };
  AUTO_NUMEROS_CACHE = new Map();
  AUTO_MONTO_OVERRIDE = {};
  // Por defecto quedan marcadas todas las disponibles; el admin desmarca las que no quiera.
  AUTO_SELECCION = new Set(lista.map(f=>f.loteria).filter(l => !autoLoteriaYaEnviada(l)));

  document.getElementById('njManualGenBtns').style.display = 'none';
  document.getElementById('njModalBodyNJ')?.classList.add('nj-auto-on');
  document.getElementById('btnAutoSalirNJ').style.display = '';
  const res = document.getElementById('njAutoResumen');
  res.style.display = '';
  res.innerHTML = `🤖 <b>Automática activa</b> — grupo "${g.titulo}" · ${AUTO_ESTRATEGIA_NOMBRE[AUTO_RESULTADOS.estrategia]} · ${AUTO_TIPO_NOMBRE[AUTO_RESULTADOS.tipo] || AUTO_RESULTADOS.tipo}. Marca las loterías a jugar y toca <b>Enviar jugada</b>: se envía una jugada separada por cada lotería marcada, a cada jugador seleccionado.`;

  autoRenderGrupos();
  autoRefrescarPlan();
}

/* Salir del modo automático → vuelve al flujo manual de siempre.
   silent=true: solo limpia el estado/UI (lo usa el modal al abrirse). */
function autoSalirNJ(silent){
  NJ_AUTO = { activo:false, estrategia:'numerologo', tipo:'QUINIELA', grupo:'', loterias:new Set() };
  AUTO_PLAN_TOKEN++;
  AUTO_RESULTADOS = null; AUTO_PLAN = null;
  AUTO_SELECCION = new Set(); AUTO_NUMEROS_CACHE = new Map(); AUTO_MONTO_OVERRIDE = {};
  const set = (id, fn)=>{ const el = document.getElementById(id); if(el) fn(el); };
  set('njManualGenBtns', el=>el.style.display = '');
  set('njModalBodyNJ', el=>el.classList.remove('nj-auto-on'));
  set('btnAutoSalirNJ', el=>el.style.display = 'none');
  set('njAutoResumen', el=>{ el.style.display = 'none'; el.innerHTML = ''; });
  set('njAutoBox', el=>el.style.display = 'none');
  set('njAutoGrupos', el=>el.innerHTML = '');
  set('njAutoPlan', el=>el.innerHTML = '');
  set('njAutoEstado', el=>el.textContent = '');
  if(!silent){
    actualizarLoteriasDisponiblesNJ();
    resetearNumerologoNJ();
  }
}

/* ---------------- 4) PLAN: números + montos por lotería y por jugador ---------------- */
/* Números de UNA lotería, generados EXACTAMENTE como en el testeo
   (simGenerarNumerosDelDia: misma estrategia, mismo tipo, historial
   anterior a la fecha del sorteo). */
async function autoNumerosDe(loteria, fecha){
  const key = `${loteria}|${fecha}|${NJ_AUTO.estrategiaSim}|${NJ_AUTO.tipo}`;
  if(AUTO_NUMEROS_CACHE.has(key)) return AUTO_NUMEROS_CACHE.get(key);
  const hist = (await simCargarHistorialConFechas(loteria)).filter(d => d.fecha < fecha);
  const numeros = hist.length
    ? simGenerarNumerosDelDia(hist, NJ_AUTO.estrategiaSim, NJ_AUTO.tipo, GEN_CONFIG.numerologo.cantidadGanar85 || 30)
    : null;
  AUTO_NUMEROS_CACHE.set(key, numeros);
  return numeros;
}

/* Arma el plan de envío: una entrada por cada lotería marcada. */
async function autoCalcularPlan(){
  const fecha = autoFechaSorteo();
  const jugadores = Array.from(NJ_JUGADORES_SELECCIONADOS);
  const items = [];
  for(const loteria of AUTO_SELECCION){
    const item = { loteria, hora: HORARIOS_LOTERIA[loteria] || '', numeros: null, porJugador:{}, error:'' };
    items.push(item);
    if(!item.hora){ item.error = 'sin hora de sorteo configurada'; continue; }
    if(fecha && existeLoteriaYaEnviada({ loteria, fecha, horaSorteo:item.hora })){ item.error = 'ya se envió para esta fecha'; continue; }
    if(fecha){
      const diff = (new Date(`${fecha}T${item.hora}:00`) - new Date()) / 60000;
      if(diff < 35){ item.error = 'faltan menos de 35 min (o ya pasó)'; continue; }
    }
    try{
      item.numeros = fecha ? await autoNumerosDe(loteria, fecha) : null;
    }catch(err){ console.error(err); }
    if(fecha && (!item.numeros || !item.numeros.length)){ item.error = 'sin historial para generar números'; continue; }
    const sugs = await Promise.all(jugadores.map(u => calcularSugerenciaMontoLoteria(u, loteria, NJ_AUTO.estrategia)));
    jugadores.forEach((u, i)=>{
      const sug = sugs[i];
      const ov = AUTO_MONTO_OVERRIDE[`${loteria}|${u}`];
      const base = sug.modo === 'auto' ? sug.monto : ((AUTO_RESULTADOS?.montoBase) || NJ_MONTO_MANUAL_DEFAULT);
      item.porJugador[u] = { monto: ov > 0 ? ov : base, modo: sug.modo, nivel: sug.nivel || 1 };
    });
  }
  return items;
}

let AUTO_PLAN_TIMER = null;
function autoRefrescarPlan(){
  clearTimeout(AUTO_PLAN_TIMER);
  AUTO_PLAN_TIMER = setTimeout(autoRefrescarPlanYa, 120);
}
async function autoRefrescarPlanYa(){
  const cont = document.getElementById('njAutoPlan');
  if(!cont) return;
  if(!NJ_AUTO.activo){ cont.innerHTML = ''; return; }
  if(AUTO_SELECCION.size === 0){ cont.innerHTML = '<div class="small-muted">Marca al menos una lotería del grupo.</div>'; AUTO_PLAN = null; document.getElementById('njTotal').value = ''; return; }
  if(NJ_JUGADORES_SELECCIONADOS.size === 0){ cont.innerHTML = '<div class="small-muted">Marca al menos un jugador (arriba) para ver los números y montos de cada lotería.</div>'; AUTO_PLAN = null; document.getElementById('njTotal').value = ''; return; }
  const token = ++AUTO_PLAN_TOKEN;
  cont.innerHTML = '<div class="small-muted">Calculando números y montos de cada lotería marcada...</div>';
  try{
    const plan = await autoCalcularPlan();
    if(token !== AUTO_PLAN_TOKEN || !NJ_AUTO.activo) return;
    AUTO_PLAN = plan;
    autoRenderPlan();
  }catch(err){
    console.error(err);
    if(token === AUTO_PLAN_TOKEN) cont.innerHTML = '<div class="small-muted">Error al calcular: ' + err.message + '</div>';
  }
}

function autoRenderPlan(){
  const cont = document.getElementById('njAutoPlan');
  if(!AUTO_PLAN) return;
  let total = 0;
  const html = AUTO_PLAN.map(it=>{
    if(it.error) return `<div class="auto-grupo" style="opacity:.6;"><div class="auto-grupo-titulo">${it.loteria} <span class="small-muted">· ${it.hora || '—'}</span></div><div class="small-muted">Se omitirá: ${it.error}.</div></div>`;
    const filas = Object.keys(it.porJugador).map(u=>{
      const d = it.porJugador[u];
      const nombre = VENDEDORES.find(v=>v.usuario===u)?.nombre || u;
      const sub = d.monto * it.numeros.length;
      total += sub;
      return `<div class="auto-grupo-fila">
        <span class="n">${nombre} <span class="small-muted">${d.modo==='auto'?'Martingala':'Manual'} · Nivel ${d.nivel}</span></span>
        <span class="m"><input type="number" min="1" class="auto-monto-input" data-loteria="${it.loteria}" data-usuario="${u}" value="${d.monto}" style="width:64px; padding:3px 6px;" /> × ${it.numeros.length} = <b>${fmtMoney(sub)}</b></span>
      </div>`;
    }).join('');
    return `<div class="auto-grupo">
      <div class="auto-grupo-titulo">${it.loteria} <span class="small-muted">· sorteo ${it.hora} · ${it.numeros.length} número${it.numeros.length===1?'':'s'}</span></div>
      <div class="mono" style="font-size:12px; margin:4px 0;">${it.numeros.join(', ')}</div>
      ${filas}
    </div>`;
  }).join('');
  const validas = AUTO_PLAN.filter(x=>!x.error).length;
  cont.innerHTML = `<div class="small-muted" style="margin:4px 0 8px;"><b>Se enviarán ${validas} jugada${validas===1?'':'s'} por jugador</b> (una por lotería, con los mismos números del testeo). Puedes ajustar el monto de cada jugador.</div>${html}`;
  document.getElementById('njTotal').value = fmtMoney(total);
}
document.getElementById('njAutoPlan')?.addEventListener('input', (e)=>{
  if(!e.target.classList.contains('auto-monto-input')) return;
  const { loteria, usuario } = e.target.dataset;
  AUTO_MONTO_OVERRIDE[`${loteria}|${usuario}`] = Number(e.target.value) || 0;
  const it = AUTO_PLAN?.find(x=>x.loteria===loteria);
  if(it && it.porJugador[usuario]) it.porJugador[usuario].monto = Number(e.target.value) || 0;
  // recalcula total sin repintar (para no perder el foco del input)
  let total = 0;
  AUTO_PLAN.forEach(x=>{ if(x.error) return; Object.values(x.porJugador).forEach(d=> total += d.monto * x.numeros.length); });
  document.getElementById('njTotal').value = fmtMoney(total);
});

// Cambios de jugadores marcados o de fecha → recalcular el plan (y refrescar lo ya enviado)
['njJugadoresList'].forEach(id=> document.getElementById(id)?.addEventListener('change', ()=>{ if(NJ_AUTO.activo) autoRefrescarPlan(); }));
['btnNJMarcarTodos','btnNJDesmarcarTodos'].forEach(id=> document.getElementById(id)?.addEventListener('click', ()=>{ if(NJ_AUTO.activo) autoRefrescarPlan(); }));
document.getElementById('njFecha')?.addEventListener('change', ()=>{
  if(!NJ_AUTO.activo) return;
  // otra fecha: se quitan de la selección las que ya estén enviadas ese día
  Array.from(AUTO_SELECCION).forEach(l=>{ if(autoLoteriaYaEnviada(l)) AUTO_SELECCION.delete(l); });
  autoRenderGrupos();
  autoRefrescarPlan();
});

/* ---------------- 5) ENVÍO: una jugada por lotería marcada × jugador ---------------- */
async function autoEnviarSeleccionadas(btn){
  const jugadores = Array.from(NJ_JUGADORES_SELECCIONADOS);
  const fecha = autoFechaSorteo();
  if(jugadores.length === 0){ toast('Marca al menos un jugador para enviarle las jugadas.', 'danger'); return; }
  if(!fecha){ toast('Elige la fecha del sorteo.', 'danger'); return; }
  if(AUTO_SELECCION.size === 0){ toast('Marca al menos una lotería del grupo.', 'danger'); return; }

  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = 'Preparando...';
  try{
    // Se recalcula el plan fresco (respeta los montos editados a mano)
    const plan = await autoCalcularPlan();
    const validos = plan.filter(x=>!x.error);
    const omitidas = plan.filter(x=>x.error);
    if(validos.length === 0){
      toast('Ninguna de las loterías marcadas se puede enviar: ' + omitidas.map(o=>`${o.loteria} (${o.error})`).join('; '), 'danger');
      return;
    }

    const docs = [];       // { vendedor, item }
    const saltados = [];   // duplicados por jugador
    validos.forEach(item=>{
      jugadores.forEach(vendedor=>{
        const d = item.porJugador[vendedor];
        if(!d || !(d.monto > 0)){ saltados.push(`${item.loteria}/${vendedor}: sin monto`); return; }
        if(existeJugadaDuplicada({ vendedor, loteria:item.loteria, fecha, tipoJugada:NJ_AUTO.tipo, numeros:item.numeros })){
          saltados.push(`${item.loteria}/${vendedor}: ya enviada`); return;
        }
        docs.push({ vendedor, item, monto:d.monto });
      });
    });
    if(docs.length === 0){ toast('Todas esas jugadas ya estaban enviadas o no tienen monto.', 'danger'); return; }

    btn.textContent = 'Enviando...';
    // Reserva optimista (evita doble envío mientras Firestore responde)
    const reservas = docs.map(x=>({ vendedor:x.vendedor, loteria:x.item.loteria, fecha, horaSorteo:x.item.hora, tipoJugada:NJ_AUTO.tipo, numeros:x.item.numeros, estado:'pendiente' }));
    reservas.forEach(r=>JUGADAS.push(r));

    try{
      for(let i=0; i<docs.length; i+=400){ // límite de Firestore: 500 operaciones por batch
        const batch = db.batch();
        docs.slice(i, i+400).forEach(({vendedor, item, monto})=>{
          const ref = db.collection(COL_JUGADAS).doc();
          batch.set(ref, {
            ticketId: generarTicketId(), vendedor, loteria:item.loteria, tipoJugada:NJ_AUTO.tipo, fecha, numeros:item.numeros,
            horaSorteo:item.hora, limiteJuego:`${fecha}T${item.hora}:00`,
            montoPorNumero:monto, montoTotal:item.numeros.length * monto, estado:'pendiente',
            modoAutomatico:true, grupoAutomatico:NJ_AUTO.grupo,
            estrategiaGeneracion:NJ_AUTO.estrategia,
            enviadoPor:CURRENT_USER.usuario,
            fechaEnvio:firebase.firestore.FieldValue.serverTimestamp(),
          });
        });
        await batch.commit();
      }
    }catch(err){
      reservas.forEach(r=>{ const k = JUGADAS.indexOf(r); if(k !== -1) JUGADAS.splice(k,1); });
      throw err;
    }

    let msg = `Enviadas ${docs.length} jugada${docs.length===1?'':'s'} (${validos.length} lotería${validos.length===1?'':'s'} × ${jugadores.length} jugador${jugadores.length===1?'':'es'}).`;
    if(omitidas.length) msg += ` Omitidas: ${omitidas.map(o=>`${o.loteria} (${o.error})`).join(', ')}.`;
    if(saltados.length) msg += ` Saltadas: ${saltados.length}.`;
    toast(msg, 'success');
    closeModal('modalNuevaJugada');
  }catch(err){
    console.error('Automática — error al enviar:', err);
    toast('No se pudieron enviar las jugadas: ' + err.message, 'danger');
  }finally{
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}
