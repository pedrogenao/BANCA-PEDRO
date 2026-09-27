/* ========================================================================
   SIMULACION.JS
   Admin: "Simulación" — corre un backtest histórico de martingala sobre
   los resultados oficiales REALES guardados en Firestore, usando
   exactamente el mismo motor de generación de números y la misma
   matemática de martingala que "Enviar jugada", corrida día por día
   desde una fecha de partida hasta hoy, sobre UNA sola lotería/tipo/
   estrategia elegidos por el admin.

   🆕 Ahora respeta el "rango histórico" configurado en Configuración
   para la estrategia elegida (todo/3m/2m/1m/15d), y agrega dos funciones
   nuevas (simEvaluarEstadoActual / simFiltrarLoteriasPorEstado) que
   reutiliza "Nueva jugada" para el pre-filtro automático de loterías.

   REGLA DE ORO: para generar los números del sorteo de un día X, SOLO
   se usa el historial de resultados con fecha ANTERIOR a X.
   ====================================================================== */
let SIM_TIPO = 'QUINIELA';
let SIM_ESTRATEGIA = 'numerologo';

// 🆕 Mapea el id de estrategia usado en Simulación/Nueva-jugada a la
// clave real de GEN_CONFIG donde vive su configuración (incluido el
// rangoHistorico).
const SIM_ESTRATEGIA_A_CFG = { numerologo:'numerologo', tendencia:'numerologoTendencia', numerologitos:'numerologitos' };

function poblarSelectSimLoterias(){
  const sel = document.getElementById('simLoteria');
  if(!sel) return;
  const anterior = sel.value;
  const lista = filtrarLoteriasPorTipo(listaLoteriasOrdenadas(), 'multiple');
  sel.innerHTML = lista.length
    ? construirOptionsLoterias(lista, 'multiple')
    : `<option value="">${LOTERIAS.length===0 ? '— cargando catálogo de loterías... —' : '— sin loterías de más de una jugada —'}</option>`;
  if(anterior && lista.includes(anterior)) sel.value = anterior;
}

function abrirVistaSimulacion(){
  if(!esAdmin()) return;
  poblarSelectSimLoterias();
  const fechaInput = document.getElementById('simFechaPartida');
  if(fechaInput){
    fechaInput.max = hoyStr();
    if(!fechaInput.value){
      const d = new Date();
      d.setMonth(d.getMonth() - 1);
      fechaInput.value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }
  }
}

document.getElementById('simTipoChips')?.addEventListener('click', (e)=>{
  const chip = e.target.closest('.filter-tab');
  if(!chip) return;
  document.querySelectorAll('#simTipoChips .filter-tab').forEach(c=>c.classList.remove('active'));
  chip.classList.add('active');
  SIM_TIPO = chip.dataset.tipo;
  document.getElementById('simGanar85Wrap').style.display = (SIM_TIPO === 'GANAR 85% SEGURO') ? '' : 'none';
});

document.getElementById('simEstrategiaChips')?.addEventListener('click', (e)=>{
  const chip = e.target.closest('.filter-tab');
  if(!chip) return;
  document.querySelectorAll('#simEstrategiaChips .filter-tab').forEach(c=>c.classList.remove('active'));
  chip.classList.add('active');
  SIM_ESTRATEGIA = chip.dataset.estrategia;
});

document.getElementById('simMartingalaCheck')?.addEventListener('change', (e)=>{
  document.getElementById('simMartingalaSwitch').classList.toggle('on', e.target.checked);
  document.getElementById('simMartingalaNivelWrap').style.display = e.target.checked ? '' : 'none';
});
document.getElementById('simMartingalaSwitch')?.classList.toggle('on', !!document.getElementById('simMartingalaCheck')?.checked);

/* ======================================================================
   2) HISTORIAL: trae TODO el historial oficial de la lotería elegida
   ====================================================================== */
async function simCargarHistorialConFechas(loteria){
  const snap = await db.collection('loterias').doc(loteria).collection('resultados').get();
  const filas = [];
  snap.docs.forEach(doc=>{
    const numeros = doc.data().numeros;
    if(Array.isArray(numeros) && numeros.length) filas.push({ fecha: doc.id, numeros });
  });
  filas.sort((a,b)=> a.fecha < b.fecha ? -1 : (a.fecha > b.fecha ? 1 : 0));
  return filas; // ascendente: [0] = más antiguo
}

/* ======================================================================
   3) GENERACIÓN DE NÚMEROS POR ESTRATEGIA
   ====================================================================== */
function simNumerologoCargarTipos(historialAscNumeros, tipo, cantidadOverride){
  if(!historialAscNumeros.length) return null;
  const cfg = GEN_CONFIG.numerologo;
  const cantidadGanar85 = cantidadOverride || cfg.cantidadGanar85 || 30;
  const basePoolSize = tipo === 'GANAR 85% SEGURO' ? cantidadGanar85 : Math.max(cantidadGanar85, NUM_CANTIDAD_DEFAULT[tipo] || 1);
  const universoBase = Array.from({length:100}, (_,i)=>i);
  const { pool } = genCombinarEstrategias(historialAscNumeros, cfg.estrategias, basePoolSize, {
    tendencia: cfg.tendencia, sorteosTendencia: cfg.sorteosTendencia, exclusion: cfg.exclusion,
    exclusionCantidad: cfg.exclusionCantidad, exclusionPosiciones: cfg.exclusionPosiciones, universoBase,
  });
  const cantidadFinal = tipo === 'GANAR 85% SEGURO' ? basePoolSize : (NUM_CANTIDAD_DEFAULT[tipo] || 1);
  const numeros = pool.slice(0, cantidadFinal).sort((a,b)=>a-b);
  return numeros.length ? numeros : null;
}

function simCantidadParaTipo(tipo, cantidadGanar85){
  if(tipo === 'QUINIELA') return 1;
  if(tipo === 'PALE') return 2;
  if(tipo === 'TRIPLETAS') return 3;
  if(tipo === 'GANAR 85% SEGURO') return cantidadGanar85;
  return 1;
}

/* Genera los números del día según la estrategia elegida. `historialAsc`
   viene SIEMPRE recortado (solo fechas anteriores al día que se juega,
   y ya con el rango histórico aplicado por quien llama a esta función). */
function simGenerarNumerosDelDia(historialAsc, estrategia, tipo, cantidadGanar85){
  if(!historialAsc.length) return null;
  if(estrategia === 'numerologo'){
    const cantidadOverride = tipo === 'GANAR 85% SEGURO' ? cantidadGanar85 : undefined;
    return simNumerologoCargarTipos(historialAsc.map(d=>d.numeros), tipo, cantidadOverride);
  }
  const historialDesc = historialAsc.slice().reverse();
  const cantidad = simCantidadParaTipo(tipo, cantidadGanar85);
  let resultado = null;
  if(estrategia === 'tendencia') resultado = generarNumerosNumerologoDeTendencia(historialDesc);
  else if(estrategia === 'numerologitos') resultado = generarNumerosNumerologuitos(historialDesc);
  if(!resultado || !resultado.numeros || !resultado.numeros.length) return null;
  const numeros = resultado.numeros.slice(0, cantidad);
  return numeros.length ? numeros : null;
}

/* ======================================================================
   4) MARTINGALA — misma matemática EXACTA que calcularSugerenciaMontoLoteria
   ====================================================================== */
const SIM_MONTO_MINIMO = 3;
const SIM_MULTIPLICADOR_OBJETIVO = MULTIPLICADOR_PREMIO[0];
const SIM_MARGEN_GANANCIA = 0.15;

function simCalcularMontoPorNumero(estado, cantidadNumeros, martingalaActiva, nivelMaximo, montoBase){
  if(!martingalaActiva || estado.nivelActual === 0){
    return { monto: montoBase, nivel: 1 };
  }
  const N = cantidadNumeros || 1;
  const perdidaAcumulada = estado.perdidaAcumulada;
  const gananciaDeseada = Math.max(perdidaAcumulada * SIM_MARGEN_GANANCIA, SIM_MONTO_MINIMO);
  let monto, advertencia = false;
  if(SIM_MULTIPLICADOR_OBJETIVO > N){
    monto = Math.ceil((perdidaAcumulada + gananciaDeseada) / (SIM_MULTIPLICADOR_OBJETIVO - N));
  } else {
    monto = Math.ceil((perdidaAcumulada * 2) / N);
    advertencia = true;
  }
  if(monto < SIM_MONTO_MINIMO) monto = SIM_MONTO_MINIMO;
  const nivel = Math.min(estado.nivelActual + 1, nivelMaximo);
  return { monto, nivel, advertencia };
}

function simCalcularGananciaBruta(numerosJugados, montoPorNumero, numerosResultado){
  let monto = 0;
  const detalle = [];
  numerosJugados.forEach(n=>{
    const numNorm = normalizarNumeroComparacion(n);
    numerosResultado.forEach((rn, idx)=>{
      if(normalizarNumeroComparacion(rn) !== numNorm) return;
      if(MULTIPLICADOR_PREMIO[idx] === undefined) return;
      const premio = montoPorNumero * MULTIPLICADOR_PREMIO[idx];
      monto += premio;
      detalle.push({ numero:n, posicion: idx+1, premio });
    });
  });
  return { monto, detalle };
}

/* ======================================================================
   5) MOTOR PRINCIPAL DE LA SIMULACIÓN (vista "Simulación", detallada)
   🆕 Recorta historialAntes por el rango histórico configurado para la
   estrategia elegida (GEN_CONFIG[cfg correspondiente].rangoHistorico).
   ====================================================================== */
async function simEjecutar(){
  if(!esAdmin()) return;
  const loteria = document.getElementById('simLoteria').value;
  const fechaPartida = document.getElementById('simFechaPartida').value;
  const inversion = Number(document.getElementById('simInversion').value) || 0;
  const montoBase = Math.min(100, Math.max(1, Number(document.getElementById('simMontoBase').value) || 5));
  const cantidadGanar85 = Math.min(60, Math.max(5, Number(document.getElementById('simGanar85Cantidad').value) || 30));
  const martingalaActiva = !!document.getElementById('simMartingalaCheck').checked;
  const nivelMaximo = martingalaActiva ? Math.min(10, Math.max(1, Number(document.getElementById('simMartingalaNivelMax').value) || 4)) : 1;
  const hoy = hoyStr();
  const estadoEl = document.getElementById('simEstado');
  const btn = document.getElementById('btnSimular');

  if(!loteria){ toast('Elige una lotería primero.', 'danger'); return; }
  if(!fechaPartida){ toast('Elige una fecha de partida.', 'danger'); return; }
  if(fechaPartida > hoy){ toast('La fecha de partida no puede ser futura.', 'danger'); return; }
  if(inversion <= 0){ toast('Ingresa una inversión de partida mayor a 0.', 'danger'); return; }

  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = 'Simulando...';
  estadoEl.textContent = 'Cargando historial de resultados oficiales...';
  document.getElementById('simResultadosWrap').style.display = 'none';

  // 🆕 Rango histórico configurado para la estrategia elegida
  const cfgKeySim = SIM_ESTRATEGIA_A_CFG[SIM_ESTRATEGIA] || 'numerologo';
  const rangoSim = GEN_CONFIG[cfgKeySim]?.rangoHistorico || 'todo';

  try{
    const historialCompleto = await simCargarHistorialConFechas(loteria);
    const indicePorFecha = new Map(historialCompleto.map((d, i)=>[d.fecha, i]));
    const diasARecorrer = historialCompleto.filter(d => d.fecha >= fechaPartida && d.fecha <= hoy);

    if(diasARecorrer.length === 0){
      estadoEl.textContent = `No hay sorteos oficiales de ${loteria} entre ${fechaPartida} y hoy.`;
      return;
    }

    estadoEl.textContent = `Simulando ${diasARecorrer.length} sorteo(s)...`;

    let saldo = inversion;
    let perdidaMaxima = 0;
    let gananciaMaxima = 0;
    let maxNivelAlcanzado = 0;
    let sorteosJugados = 0;
    let sorteosSaltados = 0;
    let quiebra = false;
    let fechaQuiebra = null;
    const filas = [];

    let estado = { nivelActual: 0, perdidaAcumulada: 0 };

    for(const dia of diasARecorrer){
      const idx = indicePorFecha.get(dia.fecha);
      let historialAntes = historialCompleto.slice(0, idx); // SOLO fechas anteriores a este sorteo
      historialAntes = recortarHistorialPorRango(historialAntes, rangoSim, dia.fecha); // 🆕

      if(historialAntes.length === 0){ sorteosSaltados++; continue; }

      const numerosJugados = simGenerarNumerosDelDia(historialAntes, SIM_ESTRATEGIA, SIM_TIPO, cantidadGanar85);
      if(!numerosJugados || numerosJugados.length === 0){ sorteosSaltados++; continue; }

      const cantidadNumeros = numerosJugados.length;
      const sugerencia = simCalcularMontoPorNumero(estado, cantidadNumeros, martingalaActiva, nivelMaximo, montoBase);
      const invertido = sugerencia.monto * cantidadNumeros;

      if(invertido > saldo){
        quiebra = true;
        fechaQuiebra = dia.fecha;
        break;
      }

      const { monto: gananciaBruta } = simCalcularGananciaBruta(numerosJugados, sugerencia.monto, dia.numeros);
      const perdidaNeta = invertido - gananciaBruta;

      saldo += (gananciaBruta - invertido);
      sorteosJugados++;
      maxNivelAlcanzado = Math.max(maxNivelAlcanzado, sugerencia.nivel);

      const variacion = saldo - inversion;
      if(variacion < -perdidaMaxima) perdidaMaxima = -variacion;
      if(variacion > gananciaMaxima) gananciaMaxima = variacion;

      filas.push({
        fecha: dia.fecha, nivel: sugerencia.nivel, numeros: numerosJugados,
        montoPorNumero: sugerencia.monto, invertido, resultado: dia.numeros,
        ganado: gananciaBruta, saldo,
      });

      if(!martingalaActiva || perdidaNeta <= 0){
        estado = { nivelActual: 0, perdidaAcumulada: 0 };
      } else {
        const nuevoNivel = estado.nivelActual + 1;
        if(nuevoNivel > nivelMaximo){
          estado = { nivelActual: 0, perdidaAcumulada: 0 };
        } else {
          estado = { nivelActual: nuevoNivel, perdidaAcumulada: estado.perdidaAcumulada + perdidaNeta };
        }
      }
    }

    simRenderResultados({
      inversion, saldo, perdidaMaxima, gananciaMaxima, maxNivelAlcanzado,
      sorteosJugados, sorteosSaltados, quiebra, fechaQuiebra, filas, loteria,
      martingalaActiva, nivelMaximo,
    });

    estadoEl.textContent = `Listo — ${sorteosJugados} sorteo(s) simulado(s)${sorteosSaltados ? `, ${sorteosSaltados} saltado(s) por falta de historial` : ''}.`;
  }catch(err){
    console.error('Error en la simulación:', err);
    estadoEl.textContent = 'Error al simular: ' + err.message;
    toast('Error al correr la simulación.', 'danger');
  }finally{
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}
document.getElementById('btnSimular')?.addEventListener('click', simEjecutar);

/* ======================================================================
   🆕 6) EVALUACIÓN RÁPIDA DE ESTADO ACTUAL (para el pre-filtro de
   loterías en "Nueva jugada") — corre el mismo motor que simEjecutar
   pero SOLO trackeando la racha (nivel de martingala y si el último
   sorteo resuelto ganó o perdió), sin saldo ni tabla de detalle. Usa
   TODO el historial disponible de cada lotería (desde el 2do sorteo
   hasta ayer), recortado por el rango histórico configurado.
   ====================================================================== */
async function simEvaluarEstadoActual({ loteria, tipo, estrategia, cantidadGanar85, rango, martingalaActiva, nivelMaximo, montoBase }){
  const historialCompleto = await simCargarHistorialConFechas(loteria);
  const hoy = hoyStr();
  let estado = { nivelActual: 0, perdidaAcumulada: 0 };
  let ultimoGano = null, sorteosSimulados = 0;

  for(let idx = 1; idx < historialCompleto.length; idx++){
    const dia = historialCompleto[idx];
    if(dia.fecha >= hoy) break; // nunca mirar hoy ni el futuro

    let historialAntes = historialCompleto.slice(0, idx);
    historialAntes = recortarHistorialPorRango(historialAntes, rango, dia.fecha);
    if(historialAntes.length === 0) continue;

    const numerosJugados = simGenerarNumerosDelDia(historialAntes, estrategia, tipo, cantidadGanar85);
    if(!numerosJugados || numerosJugados.length === 0) continue;

    const sugerencia = simCalcularMontoPorNumero(estado, numerosJugados.length, martingalaActiva, nivelMaximo, montoBase);
    const { monto: gananciaBruta } = simCalcularGananciaBruta(numerosJugados, sugerencia.monto, dia.numeros);
    const perdidaNeta = (sugerencia.monto * numerosJugados.length) - gananciaBruta;

    ultimoGano = perdidaNeta <= 0;
    sorteosSimulados++;

    if(!martingalaActiva || perdidaNeta <= 0){
      estado = { nivelActual: 0, perdidaAcumulada: 0 };
    } else {
      const nuevoNivel = estado.nivelActual + 1;
      estado = nuevoNivel > nivelMaximo
        ? { nivelActual: 0, perdidaAcumulada: 0 }
        : { nivelActual: nuevoNivel, perdidaAcumulada: estado.perdidaAcumulada + perdidaNeta };
    }
  }
  return { loteria, nivelActual: estado.nivelActual, gano: ultimoGano, sorteosSimulados };
}

/* 🆕 Evalúa TODAS las loterías "de más de una jugada" en paralelo y
   devuelve solo los nombres que pasan el filtro elegido:
     - 'ganadoras'  -> el último sorteo resuelto de esa lotería ganó (racha limpia)
     - 'perdedoras' -> el último sorteo resuelto perdió (racha activa)
     - 'nivelAlto'  -> están en el nivel de martingala más alto de todo el grupo
     - 'todas'      -> cualquier lotería con al menos un sorteo simulable
   Loterías sin ningún sorteo simulable (historial insuficiente) quedan
   fuera de cualquier filtro. */
async function simFiltrarLoteriasPorEstado({ tipo, estrategia, filtro, rango, cantidadGanar85, martingalaActiva, nivelMaximo, montoBase }){
  const candidatas = filtrarLoteriasPorTipo(listaLoteriasOrdenadas(), 'multiple');
  const evaluaciones = await Promise.all(candidatas.map(loteria =>
    simEvaluarEstadoActual({ loteria, tipo, estrategia, cantidadGanar85, rango, martingalaActiva, nivelMaximo, montoBase })
  ));
  const conDatos = evaluaciones.filter(e => e.sorteosSimulados > 0);

  if(filtro === 'ganadoras')  return conDatos.filter(e => e.gano === true).map(e => e.loteria);
  if(filtro === 'perdedoras') return conDatos.filter(e => e.gano === false).map(e => e.loteria);
  if(filtro === 'nivelAlto'){
    const maxNivel = Math.max(0, ...conDatos.map(e => e.nivelActual));
    return maxNivel === 0 ? [] : conDatos.filter(e => e.nivelActual === maxNivel).map(e => e.loteria);
  }
  return conDatos.map(e => e.loteria); // 'todas'
}

/* ======================================================================
   7) RENDER DE RESULTADOS (vista "Simulación")
   ====================================================================== */
function simRenderResultados(r){
  const wrap = document.getElementById('simResultadosWrap');
  wrap.style.display = '';

  document.getElementById('simSaldoInicial').textContent = fmtMoney(r.inversion);
  document.getElementById('simPerdidaMaxima').textContent = fmtMoney(r.perdidaMaxima);
  document.getElementById('simGananciaMaxima').textContent = fmtMoney(r.gananciaMaxima);
  document.getElementById('simMaxNivel').textContent = !r.martingalaActiva
    ? 'Martingala desactivada'
    : (r.maxNivelAlcanzado ? `Nivel ${r.maxNivelAlcanzado} de ${r.nivelMaximo}` : '—');
  document.getElementById('simSaldoFinal').textContent = fmtMoney(r.saldo);
  document.getElementById('simSorteosJugados').textContent = String(r.sorteosJugados);
  document.getElementById('simCantidadSorteos').textContent = `${r.sorteosJugados} sorteo${r.sorteosJugados===1?'':'s'}`;

  const gananciaNeta = r.saldo - r.inversion;
  const valorEl = document.getElementById('simValorFinal');
  const cardEl = document.getElementById('simCardFinal');
  const resumenEl = document.getElementById('simResumenTexto');
  valorEl.textContent = fmtMoneySigned(gananciaNeta);
  valorEl.classList.remove('positivo','negativo');
  cardEl.classList.remove('roi-positivo','roi-negativo','roi-neutro');
  if(gananciaNeta > 0){
    valorEl.classList.add('positivo'); cardEl.classList.add('roi-positivo');
    resumenEl.textContent = `Simulación con ganancia neta positiva sobre ${r.loteria}.`;
  } else if(gananciaNeta < 0){
    valorEl.classList.add('negativo'); cardEl.classList.add('roi-negativo');
    resumenEl.textContent = `Simulación en pérdida neta sobre ${r.loteria}.`;
  } else {
    cardEl.classList.add('roi-neutro');
    resumenEl.textContent = 'Sin ganancia ni pérdida neta.';
  }

  const notaQuiebra = document.getElementById('simNotaQuiebra');
  notaQuiebra.textContent = r.quiebra
    ? ` La simulación se detuvo el ${r.fechaQuiebra}: el saldo ya no alcanzaba para cubrir la siguiente apuesta de la martingala ("banca agotada").`
    : '';

  const tbody = document.getElementById('simTablaDetalle');
  const cardsWrap = document.getElementById('simCardsDetalle');
  if(r.filas.length === 0){
    tbody.innerHTML = '<tr class="empty-row"><td colspan="8">No se pudo jugar ningún sorteo en este rango (falta historial suficiente).</td></tr>';
    if(cardsWrap) cardsWrap.innerHTML = '';
    return;
  }

  const filasOrden = r.filas.slice().reverse();

  tbody.innerHTML = filasOrden.map(f=>{
    const gano = f.ganado > f.invertido;
    const colorSaldo = gano ? 'var(--success)' : (f.ganado > 0 ? 'inherit' : 'var(--danger)');
    return `
      <tr>
        <td>${f.fecha}</td>
        <td>Nivel ${f.nivel}</td>
        <td class="mono">${f.numeros.join(', ')}</td>
        <td>${fmtMoney(f.montoPorNumero)}</td>
        <td>${fmtMoney(f.invertido)}</td>
        <td class="mono">${f.resultado.join(', ')}</td>
        <td>${f.ganado ? fmtMoney(f.ganado) : '—'}</td>
        <td style="font-weight:700; color:${colorSaldo};">${fmtMoney(f.saldo)}</td>
      </tr>`;
  }).join('');

  if(cardsWrap){
    cardsWrap.innerHTML = filasOrden.map(f=>`
      <div class="cobro-card">
        <div class="cobro-head">
          <div class="cobro-head-left">
            <div>
              <div class="cobro-title">${f.fecha}</div>
              <div class="cobro-sub">Nivel ${f.nivel} · ${f.numeros.join(', ')}</div>
            </div>
          </div>
        </div>
        <div class="cobro-body">
          <div class="cobro-info-grid">
            <div class="cobro-info-item"><div class="lbl">Monto x número</div><div class="val">${fmtMoney(f.montoPorNumero)}</div></div>
            <div class="cobro-info-item"><div class="lbl">Invertido</div><div class="val">${fmtMoney(f.invertido)}</div></div>
            <div class="cobro-info-item"><div class="lbl">Resultado oficial</div><div class="val mono" style="font-size:13px;">${f.resultado.join(', ')}</div></div>
            <div class="cobro-info-item"><div class="lbl">Ganado</div><div class="val">${f.ganado ? fmtMoney(f.ganado) : '—'}</div></div>
            <div class="cobro-info-item"><div class="lbl">Saldo</div><div class="val">${fmtMoney(f.saldo)}</div></div>
          </div>
        </div>
      </div>`).join('');
  }
}
