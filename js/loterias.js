/* ========================================================================
   LOTERIAS.JS
   Catálogo dinámico de loterías: suscripción en tiempo real a Firestore, filtro "un tipo / más de una jugada", y helpers para poblar los selects de lotería en toda la app.
   🆕 Agrega el helper de "rango histórico" (todo/3m/2m/1m/15d), reutilizado
   por generador-numeros.js, simulacion.js y configuracion.js.
   ======================================================================== */

/* ======================================================================
   🆕 RANGO HISTÓRICO — cuánto historial hacia atrás se usa para generar
   números (Numerólogo, Tendencia, Numerologitos y Simulación).
   ====================================================================== */
const RANGOS_HISTORICOS = [
  { id:'todo', label:'Todo el historial' },
  { id:'3m',   label:'Últimos 3 meses' },
  { id:'2m',   label:'Últimos 2 meses' },
  { id:'1m',   label:'Último mes' },
  { id:'15d',  label:'Últimos 15 días' },
];

/* Calcula la fecha límite (string 'YYYY-MM-DD') hacia atrás desde
   `fechaRef` (o desde hoy si no se pasa). Devuelve null para 'todo'. */
function obtenerFechaLimiteRango(rango, fechaRef){
  if(!rango || rango === 'todo') return null;
  const ref = fechaRef ? new Date(fechaRef + 'T00:00:00') : new Date();
  const d = new Date(ref);
  if(rango === '3m') d.setMonth(d.getMonth() - 3);
  else if(rango === '2m') d.setMonth(d.getMonth() - 2);
  else if(rango === '1m') d.setMonth(d.getMonth() - 1);
  else if(rango === '15d') d.setDate(d.getDate() - 15);
  else return null;
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/* Filtra un historial [{fecha,numeros}] dejando solo lo posterior o
   igual al límite del rango (relativo a `fechaRef`, o a hoy si no se
   pasa). Si `rango` es 'todo' (o vacío), devuelve el historial tal cual. */
function recortarHistorialPorRango(historial, rango, fechaRef){
  const limite = obtenerFechaLimiteRango(rango, fechaRef);
  if(!limite) return historial;
  return historial.filter(d => d.fecha >= limite);
}

/* Pinta los chips de rango dentro de `contenedorId` y engancha el click,
   mismo patrón que inicializarFiltroTipoLoteria. */
function inicializarChipsRango(contenedorId, valorInicial, onChange){
  const cont = document.getElementById(contenedorId);
  if(!cont) return;
  cont.innerHTML = RANGOS_HISTORICOS.map(r=>
    `<div class="filter-tab${r.id===valorInicial?' active':''}" data-rango="${r.id}">${r.label}</div>`
  ).join('');
  cont.addEventListener('click', (e)=>{
    const tab = e.target.closest('.filter-tab');
    if(!tab) return;
    cont.querySelectorAll('.filter-tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    onChange(tab.dataset.rango);
  });
}

/* ======================================================================
   CATÁLOGO DE LOTERÍAS: SUSCRIPCIÓN EN TIEMPO REAL (admin y vendedor)
   ------------------------------------------------------------------
   Lee sistema_catalogo_loterias, la colección que main.py mantiene
   actualizada. Cualquier cambio (lotería nueva, horario editado, o una
   lotería desactivada) se refleja al instante en los selectores de la
   app, sin recargar la página.
   ====================================================================== */
function suscribirCatalogoLoterias(){
  const u = db.collection(COL_CATALOGO_LOTERIAS).onSnapshot(snap=>{
    const nuevoCatalogo = {};
    snap.docs.forEach(doc=>{
      const d = doc.data();
      if(d.activa === false) return; // lotería retirada del .py: no se muestra, pero no se borra su histórico
      const tipos = Array.isArray(d.tipos) && d.tipos.length ? d.tipos : [doc.id];
      nuevoCatalogo[doc.id] = {
        horario: d.horario || '',
        esUnica: !!d.esUnica,
        tipos,
      };
    });
    CATALOGO_LOTERIAS = nuevoCatalogo;
    LOTERIAS = Object.keys(CATALOGO_LOTERIAS);
    HORARIOS_LOTERIA = {};
    LOTERIAS.forEach(l=>{ HORARIOS_LOTERIA[l] = CATALOGO_LOTERIAS[l].horario; });

    poblarSelectLoterias(); // repuebla "Números" y, en cascada, "Nueva jugada"
  }, errSnap('catálogo de loterías'));
  LISTENERS.push(u);
}


/* ======================================================================
   FILTRO "UN TIPO DE JUGADA" / "MÁS DE UNA JUGADA" — reutilizable en
   cualquier lugar de la app donde se muestre una lista de loterías.
   Por defecto siempre arranca en "multiple" (más de una jugada), que es
   la gran mayoría de las loterías (quinielas: Quiniela/Palé/Tripleta/
   Ganar 85%). El admin puede cambiarlo a "unica" (LOTOMAS, KINO,
   LOTO_POOL, LOTO_REAL...) o "todas" para ver el listado completo.
   ====================================================================== */
let filtroTipoLoteriaNum = 'multiple'; // filtro del selector en "Números"
let filtroTipoLoteriaNJ  = 'multiple'; // filtro del selector en "Enviar jugada"

function filtrarLoteriasPorTipo(lista, filtro){
  if(filtro === 'unica')    return lista.filter(l => CATALOGO_LOTERIAS[l]?.esUnica);
  if(filtro === 'multiple') return lista.filter(l => !CATALOGO_LOTERIAS[l]?.esUnica);
  return lista; // 'todas'
}

/* Pinta los botones de filtro dentro de `contenedorId` y engancha el click.
   `onChange(nuevoFiltro)` se llama cada vez que el admin toca un botón. */
function inicializarFiltroTipoLoteria(contenedorId, valorInicial, onChange){
  const cont = document.getElementById(contenedorId);
  if(!cont) return;
  cont.innerHTML = `
    <div class="filter-tab${valorInicial==='multiple'?' active':''}" data-tipo="multiple">Más de una jugada</div>
    <div class="filter-tab${valorInicial==='unica'?' active':''}" data-tipo="unica">Un tipo de jugada</div>
    <div class="filter-tab${valorInicial==='todas'?' active':''}" data-tipo="todas">Todas</div>
  `;
  cont.addEventListener('click', (e)=>{
    const tab = e.target.closest('.filter-tab');
    if(!tab) return;
    cont.querySelectorAll('.filter-tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    onChange(tab.dataset.tipo);
  });
}

function listaLoteriasOrdenadas(){
  // Lista ordenada de menor a mayor hora de sorteo (las que no tienen
  // horario definido quedan al final, sin romper el orden de las demás).
  return [...LOTERIAS].sort((a,b)=>{
    const ha = HORARIOS_LOTERIA[a] || '99:99';
    const hb = HORARIOS_LOTERIA[b] || '99:99';
    return ha.localeCompare(hb);
  });
}

/* Construye las <option> de una lista de loterías. Si `filtro` es 'todas'
   las agrupa en dos <optgroup> (Un tipo de jugada / Más de una jugada)
   para que se distingan de un vistazo; si ya viene filtrada a una sola
   categoría, la deja como lista plana (los optgroup sobrarían). */
function construirOptionsLoterias(lista, filtro){
  const opt = l=>{
    const hora = HORARIOS_LOTERIA[l];
    const etiqueta = hora ? `${l} — ${formatHora12(hora)}` : l;
    return `<option value="${l}">${etiqueta}</option>`;
  };
  if(filtro !== 'todas') return lista.map(opt).join('');
  const unTipo = lista.filter(l => CATALOGO_LOTERIAS[l]?.esUnica);
  const masDeUna = lista.filter(l => !CATALOGO_LOTERIAS[l]?.esUnica);
  let html = '';
  if(unTipo.length)   html += `<optgroup label="Un tipo de jugada">${unTipo.map(opt).join('')}</optgroup>`;
  if(masDeUna.length) html += `<optgroup label="Más de una jugada">${masDeUna.map(opt).join('')}</optgroup>`;
  return html;
}

function poblarSelectLoterias(){
  const sel = document.getElementById('numLoteria');
  const anterior = sel.value;
  const lista = filtrarLoteriasPorTipo(listaLoteriasOrdenadas(), filtroTipoLoteriaNum);
  sel.innerHTML = lista.length
    ? construirOptionsLoterias(lista, filtroTipoLoteriaNum)
    : `<option value="">${LOTERIAS.length===0 ? '— cargando catálogo de loterías... —' : '— sin loterías para este filtro —'}</option>`;
  if(anterior && lista.includes(anterior)) sel.value = anterior;
  // El select de "Nueva jugada" se pobla aparte, filtrado por vendedor+fecha.
  actualizarLoteriasDisponiblesNJ();
  if(typeof poblarSelectRjLoterias === 'function' && document.getElementById('rjFecha')) poblarSelectRjLoterias();
  if(typeof poblarSelectSimLoterias === 'function' && document.getElementById('simLoteria')) poblarSelectSimLoterias();
  // Si el catálogo llega (o cambia) mientras el Numerólogo está abierto,
  // refresca sus chips de tipo de jugada / tendencia según la lotería actual.
  if(typeof numActualizarSegunLoteria === 'function' && typeof numTipoActual !== 'undefined' && numTipoActual === 'numerologo'){
    numActualizarSegunLoteria();
  }
}

/* Muestra en "Nueva jugada" SOLO las loterías que todavía NO se le han
   enviado a este vendedor en esta fecha (cualquier estado menos
   "rechazada" cuenta como ya enviada), y además aplica el filtro de
   "un tipo / más de una / todas" elegido en el modal. Así se evita, sin
   depender de que el admin se acuerde, mandarle dos veces la jugada al
   mismo jugador en el mismo sorteo. Se refresca cada vez que cambia el
   vendedor, la fecha, el filtro, o llegan jugadas nuevas por Firestore.
   🆕 Esta función se REEMPLAZA por completo en jugadas.js, que ahora
   arranca de la lista pre-filtrada por simulación (NJ_LOTERIAS_FILTRADAS_SIM)
   en vez de listaLoteriasOrdenadas(). Se deja aquí solo el comentario
   para que quede claro dónde vive la versión real. */
