/* ========================================================================
   CONFIGURACION.JS
   Vista "Configuración" (solo admin):
     1) Estado de main.py (en línea / desconectado) — solo lectura.
     2) Numerólogo (por tipo de jugada) — usado por Números→Numerólogo y
        Enviar jugada→Cargar tipos.
     3) Generar numerólogo (tendencia) — usado por Enviar jugada.
     4) Numerologitos — usado por Enviar jugada.
   Las secciones 2/3/4 editan `sistema_config/generacion_app` (ver
   js/generador-numeros.js), que el resto de la app lee en tiempo real.
   ======================================================================== */

const COL_CONFIG_GENERACION = 'sistema_config';
const DOC_ESTADO_SCRIPT = 'estado_script';

/* Cada cuánto se considera "vencido" el latido del script. main.py late
   cada 45s (LATIDO_INTERVALO_SEGUNDOS); si pasan más de este umbral sin
   noticias, se muestra "Desconectado" aunque el último dato en Firestore
   diga online:true (el script pudo haberse caído sin avisar). */
const CFG_ESTADO_UMBRAL_MS = 2 * 60 * 1000; // 2 minutos

let CFG_ESTADO_UNSUB = null;
let CFG_ESTADO_INTERVAL = null;
let CFG_ULTIMO_LATIDO_MS = null;
let CFG_ULTIMO_ESTADO_DOC = null;

function cfgPintarEstadoScript(){
  const pill = document.getElementById('cfgEstadoPill');
  const detalle = document.getElementById('cfgEstadoDetalle');
  if(!pill) return;

  if(CFG_ULTIMO_LATIDO_MS === null){
    pill.className = 'script-status-pill unknown';
    pill.textContent = '● Verificando...';
    if(detalle) detalle.textContent = 'Esperando noticias del script (main.py)...';
    return;
  }

  const ahora = Date.now();
  const haceMs = ahora - CFG_ULTIMO_LATIDO_MS;
  const enLinea = haceMs <= CFG_ESTADO_UMBRAL_MS;

  pill.className = 'script-status-pill ' + (enLinea ? 'online' : 'offline');
  pill.textContent = enLinea ? '● En línea' : '● Desconectado';

  const seg = Math.floor(haceMs / 1000);
  const haceTexto = seg < 60 ? `hace ${seg}s` : `hace ${Math.floor(seg/60)} min`;

  if(detalle){
    const doc = CFG_ULTIMO_ESTADO_DOC || {};
    const partes = [`Último aviso: ${haceTexto}`];
    if(doc.version) partes.push(doc.version);
    detalle.textContent = partes.join(' · ');
  }
}

function cfgIniciarListenerEstadoScript(){
  if(CFG_ESTADO_UNSUB){ CFG_ESTADO_UNSUB(); CFG_ESTADO_UNSUB = null; }
  if(CFG_ESTADO_INTERVAL){ clearInterval(CFG_ESTADO_INTERVAL); CFG_ESTADO_INTERVAL = null; }

  CFG_ULTIMO_LATIDO_MS = null;
  cfgPintarEstadoScript();

  CFG_ESTADO_UNSUB = db.collection(COL_CONFIG_GENERACION).doc(DOC_ESTADO_SCRIPT)
    .onSnapshot(doc=>{
      if(!doc.exists){
        CFG_ULTIMO_LATIDO_MS = null;
        CFG_ULTIMO_ESTADO_DOC = null;
        cfgPintarEstadoScript();
        return;
      }
      const data = doc.data();
      CFG_ULTIMO_ESTADO_DOC = data;
      CFG_ULTIMO_LATIDO_MS = data.ultimoLatido?.toDate ? data.ultimoLatido.toDate().getTime() : null;
      cfgPintarEstadoScript();
    }, err=>{
      console.error('[Configuración] Error escuchando estado_script:', err);
    });

  CFG_ESTADO_INTERVAL = setInterval(cfgPintarEstadoScript, 10000);
}

/* ========================================================================
   1) NUMERÓLOGO (por tipo de jugada)
   ======================================================================== */
let CFG_NUM_ESTRATEGIAS_SEL = [];
let CFG_NUM_POSICIONES_SEL = [];
let CFG_NUM_INICIALIZADO = false;

/* "Descuenta últimos sorteo" solo tiene sentido (y solo queda disponible
   para elegir) si el switch "Excluir sorteos recientes del lado ganador"
   está activo, porque ese filtro usa justamente esa configuración
   (cantidad de sorteos y posiciones) para armar su pool. */
function cfgNumExclusionActiva(){
  return document.getElementById('cfgNumExclusionCheck').checked;
}

function cfgNumPintarChipsEstrategias(){
  const exclusionActiva = cfgNumExclusionActiva();
  const cont = document.getElementById('cfgNumEstrategiasChips');
  cont.innerHTML = GEN_ESTRATEGIAS.map(e=>{
    const deshabilitado = e.id === 'descuenta_ultimos_sorteo' && !exclusionActiva;
    const clases = ['filter-tab'];
    if(CFG_NUM_ESTRATEGIAS_SEL.includes(e.id)) clases.push('active');
    if(deshabilitado) clases.push('disabled');
    const titulo = deshabilitado ? ' title="Solo disponible si \'Excluir sorteos recientes del lado ganador\' está activo"' : '';
    return `<div class="${clases.join(' ')}" data-estrategia="${e.id}"${titulo}>${e.label}</div>`;
  }).join('');
  cont.querySelectorAll('.filter-tab').forEach(chip=>{
    chip.addEventListener('click', ()=>{
      if(chip.classList.contains('disabled')) return;
      const id = chip.dataset.estrategia;
      const idx = CFG_NUM_ESTRATEGIAS_SEL.indexOf(id);
      if(idx === -1) CFG_NUM_ESTRATEGIAS_SEL.push(id);
      else CFG_NUM_ESTRATEGIAS_SEL.splice(idx, 1);
      if(CFG_NUM_ESTRATEGIAS_SEL.length === 0) CFG_NUM_ESTRATEGIAS_SEL = [id]; // al menos una
      chip.classList.toggle('active', CFG_NUM_ESTRATEGIAS_SEL.includes(id));
    });
  });
}

/* Si se apaga "Excluir sorteos recientes del lado ganador" y
   "Descuenta últimos sorteo" estaba seleccionado, se desmarca solo
   (queda al menos una estrategia activa) y se repintan los chips para
   que ese filtro se vea deshabilitado. */
function cfgNumSincronizarDescuentaConExclusion(){
  if(!cfgNumExclusionActiva()){
    const idx = CFG_NUM_ESTRATEGIAS_SEL.indexOf('descuenta_ultimos_sorteo');
    if(idx !== -1){
      CFG_NUM_ESTRATEGIAS_SEL.splice(idx, 1);
      if(CFG_NUM_ESTRATEGIAS_SEL.length === 0) CFG_NUM_ESTRATEGIAS_SEL = ['caliente'];
    }
  }
  cfgNumPintarChipsEstrategias();
}

function cfgNumPintarChipsPosiciones(){
  document.querySelectorAll('#cfgNumExclusionPosicionesChips .filter-tab').forEach(chip=>{
    const pos = Number(chip.dataset.pos);
    chip.classList.toggle('active', CFG_NUM_POSICIONES_SEL.includes(pos));
    chip.addEventListener('click', ()=>{
      const idx = CFG_NUM_POSICIONES_SEL.indexOf(pos);
      if(idx === -1) CFG_NUM_POSICIONES_SEL.push(pos);
      else CFG_NUM_POSICIONES_SEL.splice(idx, 1);
      if(CFG_NUM_POSICIONES_SEL.length === 0) CFG_NUM_POSICIONES_SEL = [pos];
      chip.classList.toggle('active', CFG_NUM_POSICIONES_SEL.includes(pos));
    });
  });
}

/* Rellena el formulario de la sección 1 con lo que haya en GEN_CONFIG.
   Se llama al abrir la vista y cada vez que llega un cambio remoto (por
   ejemplo, si dos admins tienen Configuración abierta a la vez). */
function cfgNumPintarFormulario(){
  const cfg = GEN_CONFIG.numerologo;
  CFG_NUM_ESTRATEGIAS_SEL = (cfg.estrategias || []).slice();
  CFG_NUM_POSICIONES_SEL = (cfg.exclusionPosiciones || []).slice();

  document.getElementById('cfgNumCantidadGanar85').value = cfg.cantidadGanar85;
  document.getElementById('cfgNumTendenciaCheck').checked = !!cfg.tendencia;
  document.getElementById('cfgNumTendenciaSwitch').classList.toggle('on', !!cfg.tendencia);
  document.getElementById('cfgNumSorteosTendencia').value = cfg.sorteosTendencia;
  document.getElementById('cfgNumTendenciaSorteosWrap').style.display = cfg.tendencia ? 'grid' : 'none';

  document.getElementById('cfgNumExclusionCheck').checked = !!cfg.exclusion;
  document.getElementById('cfgNumExclusionSwitch').classList.toggle('on', !!cfg.exclusion);
  document.getElementById('cfgNumExclusionCantidad').value = cfg.exclusionCantidad;
  document.getElementById('cfgNumExclusionOpcionesWrap').style.display = cfg.exclusion ? 'block' : 'none';

  // Si en Firestore quedó guardado "descuenta_ultimos_sorteo" con la
  // exclusión apagada (config vieja o editada desde otro lado), se limpia
  // acá antes de pintar los chips para no mostrar un filtro seleccionado
  // que en realidad no está disponible.
  if(!cfg.exclusion){
    CFG_NUM_ESTRATEGIAS_SEL = CFG_NUM_ESTRATEGIAS_SEL.filter(id=>id !== 'descuenta_ultimos_sorteo');
    if(CFG_NUM_ESTRATEGIAS_SEL.length === 0) CFG_NUM_ESTRATEGIAS_SEL = ['caliente'];
  }
  cfgNumPintarChipsEstrategias();
  cfgNumPintarChipsPosiciones();

  document.getElementById('cfgNumMartingalaCheck').checked = cfg.martingalaActiva !== false;
  document.getElementById('cfgNumMartingalaSwitch').classList.toggle('on', cfg.martingalaActiva !== false);
  document.getElementById('cfgNumMartingalaNivel').value = cfg.martingalaNivelMaximo || 4;
  document.getElementById('cfgNumMartingalaNivelWrap').style.display = cfg.martingalaActiva !== false ? 'grid' : 'none';
}

function cfgNumInicializarListenersFormulario(){
  document.getElementById('cfgNumTendenciaCheck').addEventListener('change', e=>{
    document.getElementById('cfgNumTendenciaSwitch').classList.toggle('on', e.target.checked);
    document.getElementById('cfgNumTendenciaSorteosWrap').style.display = e.target.checked ? 'grid' : 'none';
  });
  document.getElementById('cfgNumExclusionCheck').addEventListener('change', e=>{
    document.getElementById('cfgNumExclusionSwitch').classList.toggle('on', e.target.checked);
    document.getElementById('cfgNumExclusionOpcionesWrap').style.display = e.target.checked ? 'block' : 'none';
    // "Descuenta últimos sorteo" depende de este switch: si se apaga, se
    // desmarca solo (si estaba elegido) y el chip queda deshabilitado.
    cfgNumSincronizarDescuentaConExclusion();
  });
  document.getElementById('cfgNumMartingalaCheck').addEventListener('change', e=>{
    document.getElementById('cfgNumMartingalaSwitch').classList.toggle('on', e.target.checked);
    document.getElementById('cfgNumMartingalaNivelWrap').style.display = e.target.checked ? 'grid' : 'none';
  });
  document.getElementById('cfgNumMartingalaNivel').addEventListener('change', e=>{
    e.target.value = Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 4));
  });
  document.getElementById('cfgNumSorteosTendencia').addEventListener('change', e=>{
    let v = parseInt(e.target.value, 10) || 5;
    v = Math.min(15, Math.max(3, v));
    if(v % 2 === 0) v += (v < 15 ? 1 : -1);
    e.target.value = v;
  });
  document.getElementById('cfgNumExclusionCantidad').addEventListener('change', e=>{
    e.target.value = Math.min(15, Math.max(1, parseInt(e.target.value, 10) || 5));
  });
  document.getElementById('cfgNumCantidadGanar85').addEventListener('change', e=>{
    e.target.value = Math.min(50, Math.max(30, parseInt(e.target.value, 10) || 30));
  });

  document.getElementById('btnCfgGuardarNumerologo').addEventListener('click', async ()=>{
    const btn = document.getElementById('btnCfgGuardarNumerologo');
    const txt = document.getElementById('cfgNumGuardadoTxt');
    btn.disabled = true;
    try{
      await genGuardarSeccionConfig('numerologo', {
        estrategias: CFG_NUM_ESTRATEGIAS_SEL.slice(),
        tendencia: document.getElementById('cfgNumTendenciaCheck').checked,
        sorteosTendencia: parseInt(document.getElementById('cfgNumSorteosTendencia').value, 10) || 5,
        exclusion: document.getElementById('cfgNumExclusionCheck').checked,
        exclusionCantidad: parseInt(document.getElementById('cfgNumExclusionCantidad').value, 10) || 5,
        exclusionPosiciones: CFG_NUM_POSICIONES_SEL.slice().sort(),
        cantidadGanar85: parseInt(document.getElementById('cfgNumCantidadGanar85').value, 10) || 30,
        martingalaActiva: document.getElementById('cfgNumMartingalaCheck').checked,
        martingalaNivelMaximo: parseInt(document.getElementById('cfgNumMartingalaNivel').value, 10) || 4,
      });
      txt.textContent = 'Guardado ✓';
      toast('Configuración del Numerólogo guardada.', 'success');
    }catch(err){
      console.error(err);
      txt.textContent = '';
      toast('No se pudo guardar: ' + err.message, 'danger');
    }finally{
      btn.disabled = false;
      setTimeout(()=>{ txt.textContent=''; }, 3000);
    }
  });
}

/* ========================================================================
   2) GENERAR NUMERÓLOGO (tendencia) — 3) NUMEROLOGITOS
   ======================================================================== */
function cfgPintarFormularioTendenciaYNumerologitos(){
  const t = GEN_CONFIG.numerologoTendencia;
  document.getElementById('cfgTendSorteos').value = t.sorteosTendencia;
  document.getElementById('cfgTendCantidad').value = t.cantidadObjetivo;
  document.getElementById('cfgTendMartingalaCheck').checked = t.martingalaActiva !== false;
  document.getElementById('cfgTendMartingalaSwitch').classList.toggle('on', t.martingalaActiva !== false);
  document.getElementById('cfgTendMartingalaNivel').value = t.martingalaNivelMaximo || 4;
  document.getElementById('cfgTendMartingalaNivelWrap').style.display = t.martingalaActiva !== false ? 'grid' : 'none';

  const n = GEN_CONFIG.numerologitos;
  document.getElementById('cfgNtoSorteos').value = n.sorteosExclusion;
  document.getElementById('cfgNtoCantidad').value = n.cantidadObjetivo;
  document.getElementById('cfgNtoMartingalaCheck').checked = n.martingalaActiva !== false;
  document.getElementById('cfgNtoMartingalaSwitch').classList.toggle('on', n.martingalaActiva !== false);
  document.getElementById('cfgNtoMartingalaNivel').value = n.martingalaNivelMaximo || 4;
  document.getElementById('cfgNtoMartingalaNivelWrap').style.display = n.martingalaActiva !== false ? 'grid' : 'none';
}

function cfgInicializarListenersTendenciaYNumerologitos(){
  document.getElementById('cfgTendSorteos').addEventListener('change', e=>{
    let v = parseInt(e.target.value, 10) || 3;
    v = Math.min(15, Math.max(1, v));
    e.target.value = v;
  });
  document.getElementById('cfgTendCantidad').addEventListener('change', e=>{
    e.target.value = Math.min(60, Math.max(20, parseInt(e.target.value, 10) || 40));
  });
  document.getElementById('cfgTendMartingalaCheck').addEventListener('change', e=>{
    document.getElementById('cfgTendMartingalaSwitch').classList.toggle('on', e.target.checked);
    document.getElementById('cfgTendMartingalaNivelWrap').style.display = e.target.checked ? 'grid' : 'none';
  });
  document.getElementById('cfgTendMartingalaNivel').addEventListener('change', e=>{
    e.target.value = Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 4));
  });
  document.getElementById('btnCfgGuardarTendencia').addEventListener('click', async ()=>{
    const btn = document.getElementById('btnCfgGuardarTendencia');
    const txt = document.getElementById('cfgTendGuardadoTxt');
    btn.disabled = true;
    try{
      await genGuardarSeccionConfig('numerologoTendencia', {
        sorteosTendencia: parseInt(document.getElementById('cfgTendSorteos').value, 10) || 3,
        cantidadObjetivo: parseInt(document.getElementById('cfgTendCantidad').value, 10) || 40,
        martingalaActiva: document.getElementById('cfgTendMartingalaCheck').checked,
        martingalaNivelMaximo: parseInt(document.getElementById('cfgTendMartingalaNivel').value, 10) || 4,
      });
      txt.textContent = 'Guardado ✓';
      toast('Configuración de "Generar numerólogo" guardada.', 'success');
    }catch(err){
      console.error(err);
      toast('No se pudo guardar: ' + err.message, 'danger');
    }finally{
      btn.disabled = false;
      setTimeout(()=>{ txt.textContent=''; }, 3000);
    }
  });

  document.getElementById('cfgNtoSorteos').addEventListener('change', e=>{
    e.target.value = Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 10));
  });
  document.getElementById('cfgNtoCantidad').addEventListener('change', e=>{
    e.target.value = Math.min(40, Math.max(10, parseInt(e.target.value, 10) || 20));
  });
  document.getElementById('cfgNtoMartingalaCheck').addEventListener('change', e=>{
    document.getElementById('cfgNtoMartingalaSwitch').classList.toggle('on', e.target.checked);
    document.getElementById('cfgNtoMartingalaNivelWrap').style.display = e.target.checked ? 'grid' : 'none';
  });
  document.getElementById('cfgNtoMartingalaNivel').addEventListener('change', e=>{
    e.target.value = Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 4));
  });
  document.getElementById('btnCfgGuardarNumerologitos').addEventListener('click', async ()=>{
    const btn = document.getElementById('btnCfgGuardarNumerologitos');
    const txt = document.getElementById('cfgNtoGuardadoTxt');
    btn.disabled = true;
    try{
      await genGuardarSeccionConfig('numerologitos', {
        sorteosExclusion: parseInt(document.getElementById('cfgNtoSorteos').value, 10) || 10,
        cantidadObjetivo: parseInt(document.getElementById('cfgNtoCantidad').value, 10) || 20,
        martingalaActiva: document.getElementById('cfgNtoMartingalaCheck').checked,
        martingalaNivelMaximo: parseInt(document.getElementById('cfgNtoMartingalaNivel').value, 10) || 4,
      });
      txt.textContent = 'Guardado ✓';
      toast('Configuración de "Numerologitos" guardada.', 'success');
    }catch(err){
      console.error(err);
      toast('No se pudo guardar: ' + err.message, 'danger');
    }finally{
      btn.disabled = false;
      setTimeout(()=>{ txt.textContent=''; }, 3000);
    }
  });

  document.getElementById('btnCfgRestaurar').addEventListener('click', async ()=>{
    if(!confirm('¿Restaurar las 3 configuraciones (Numerólogo, Generar numerólogo y Numerologitos) a sus valores por defecto?')) return;
    try{
      await genRestaurarConfigPorDefecto();
      toast('Configuración restaurada a los valores por defecto.', 'success');
    }catch(err){
      console.error(err);
      toast('No se pudo restaurar: ' + err.message, 'danger');
    }
  });
}

/* ========================================================================
   INIT
   ======================================================================== */
async function abrirVistaConfiguracion(){
  if(!esAdmin()) return; // seguridad adicional, ver también nav.js
  cfgIniciarListenerEstadoScript();

  if(!CFG_NUM_INICIALIZADO){
    CFG_NUM_INICIALIZADO = true;
    cfgNumInicializarListenersFormulario();
    cfgInicializarListenersTendenciaYNumerologitos();
    genEscucharConfig(()=>{
      cfgNumPintarFormulario();
      cfgPintarFormularioTendenciaYNumerologitos();
    });
  } else {
    cfgNumPintarFormulario();
    cfgPintarFormularioTendenciaYNumerologitos();
  }
}
