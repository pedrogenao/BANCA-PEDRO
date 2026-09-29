/* ========================================================================
   JUGADAS.JS
   Envío de jugadas a los jugadores (modal "Nueva jugada", Numerólogo, sugerencia automática de monto) y el listado de jugadas tanto del lado admin como del lado jugador.
   ======================================================================== */

/* ======================================================================
   ADMIN: JUGADAS
   ====================================================================== */
/* ======================================================================
   SELECCIÓN MÚLTIPLE DE JUGADORES EN "NUEVA JUGADA"
   ------------------------------------------------------------------
   En vez de elegir un solo jugador de un <select>, el admin marca con
   checkboxes a cuáles jugadores (uno, varios o todos con "Marcar
   todos") se les enviará la MISMA jugada (misma lotería, tipo y
   números). Cada jugador recibe la jugada con SU PROPIO monto por
   número, calculado según SU propio nivel de martingala (racha) en esa
   lotería — nunca un monto compartido entre todos.
   ====================================================================== */
let NJ_JUGADORES_SELECCIONADOS = new Set();

/* Estado del modo "Automática" (ver automatica.js). Cuando está activo,
   la lista de loterías del modal se limita al grupo elegido y los números
   se generan solos con la estrategia con la que se testeó ese grupo. */
let NJ_AUTO = { activo:false, estrategia:'numerologo', tipo:'QUINIELA', grupo:'', loterias:new Set() };

function poblarSelectVendedores(){
  const lista = document.getElementById('njJugadoresList');
  if(!lista) return;

  const activos = VENDEDORES.filter(v=>v.activo!==false);

  // Quitar de la selección a cualquier jugador que ya no exista o esté inactivo
  NJ_JUGADORES_SELECCIONADOS.forEach(u=>{
    if(!activos.some(v=>v.usuario===u)) NJ_JUGADORES_SELECCIONADOS.delete(u);
  });

  lista.innerHTML = activos.length
    ? activos.map(v => `
        <label class="nj-jugador-item${NJ_JUGADORES_SELECCIONADOS.has(v.usuario) ? ' checked' : ''}" data-usuario="${v.usuario}">
          <input type="checkbox" class="nj-jugador-checkbox" value="${v.usuario}" ${NJ_JUGADORES_SELECCIONADOS.has(v.usuario) ? 'checked' : ''} />
          <span>
            <div class="nj-jugador-nombre">${v.nombre}</div>
            <div class="nj-jugador-user">@${v.usuario}</div>
          </span>
        </label>`).join('')
    : '<div class="nj-jugadores-vacio">— sin jugadores activos —</div>';

  actualizarContadorJugadoresNJ();
  if(document.getElementById('modalNuevaJugada')?.classList.contains('show')) actualizarLoteriasDisponiblesNJ();
}

function actualizarContadorJugadoresNJ(){
  const el = document.getElementById('njJugadoresContador');
  if(el) el.textContent = `${NJ_JUGADORES_SELECCIONADOS.size} seleccionado${NJ_JUGADORES_SELECCIONADOS.size===1?'':'s'}`;
}

// Delegación de eventos: marcar/desmarcar un jugador de la lista
document.getElementById('njJugadoresList').addEventListener('change', (e)=>{
  if(!e.target.classList.contains('nj-jugador-checkbox')) return;
  const usuario = e.target.value;
  const item = e.target.closest('.nj-jugador-item');
  if(e.target.checked){
    NJ_JUGADORES_SELECCIONADOS.add(usuario);
    item?.classList.add('checked');
  } else {
    NJ_JUGADORES_SELECCIONADOS.delete(usuario);
    item?.classList.remove('checked');
  }
  actualizarContadorJugadoresNJ();
  actualizarLoteriasDisponiblesNJ();
  if(NJ_MODO_GENERADO) redistribuirNumerosGeneradosNJ();
  actualizarMontosPorJugadorNJ();
});

document.getElementById('btnNJMarcarTodos').addEventListener('click', ()=>{
  document.querySelectorAll('#njJugadoresList .nj-jugador-checkbox').forEach(cb=>{
    cb.checked = true;
    NJ_JUGADORES_SELECCIONADOS.add(cb.value);
    cb.closest('.nj-jugador-item')?.classList.add('checked');
  });
  actualizarContadorJugadoresNJ();
  actualizarLoteriasDisponiblesNJ();
  if(NJ_MODO_GENERADO) redistribuirNumerosGeneradosNJ();
  actualizarMontosPorJugadorNJ();
});

document.getElementById('btnNJDesmarcarTodos').addEventListener('click', ()=>{
  document.querySelectorAll('#njJugadoresList .nj-jugador-checkbox').forEach(cb=>{
    cb.checked = false;
    cb.closest('.nj-jugador-item')?.classList.remove('checked');
  });
  NJ_JUGADORES_SELECCIONADOS.clear();
  actualizarContadorJugadoresNJ();
  actualizarLoteriasDisponiblesNJ();
  if(NJ_MODO_GENERADO) redistribuirNumerosGeneradosNJ();
  actualizarMontosPorJugadorNJ();
});

function actualizarLoteriasDisponiblesNJ(){
  const sel = document.getElementById('njLoteria');
  if(!sel) return;
  const fecha = document.getElementById('njFecha').value;
  const anterior = sel.value;

  // Una lotería se oculta de la lista en cuanto YA se le envió una
  // jugada (no rechazada) a CUALQUIER jugador para esta fecha — sin
  // importar cuáles jugadores estén marcados ahora mismo. Esto coincide
  // con la regla de envío: una vez enviada, esa lotería/sorteo queda
  // bloqueada para todos los demás, así que ni tiene sentido mostrarla
  // como opción. Las rechazadas no cuentan (si la única jugada de ese
  // sorteo fue rechazada, la lotería se libera y vuelve a aparecer).
  let disponibles = listaLoteriasOrdenadas();
  if(fecha){
    disponibles = disponibles.filter(loteria =>
      !JUGADAS.some(j => j.loteria === loteria && j.fecha === fecha && j.estado !== 'rechazada')
    );
  }
  if(NJ_AUTO.activo){
    // Modo Automática: solo las loterías del grupo elegido (ignora el filtro de tipo).
    disponibles = disponibles.filter(l => NJ_AUTO.loterias.has(l));
  } else {
    disponibles = filtrarLoteriasPorTipo(disponibles, filtroTipoLoteriaNJ);
  }

  if(disponibles.length === 0){
    sel.innerHTML = LOTERIAS.length === 0
      ? '<option value="">— cargando catálogo de loterías... —</option>'
      : (NJ_AUTO.activo
          ? '<option value="">— ninguna lotería del grupo automático está disponible para esta fecha —</option>'
          : '<option value="">— todas las loterías de este filtro ya fueron enviadas para esta fecha —</option>');
    document.getElementById('njHoraSorteo').value = '';
    //  RESETEAR TIPOS DEL NUMERÓLOGO AL NO HABER LOTERÍAS DISPONIBLES
    resetearNumerologoNJ();
    return;
  }

  sel.innerHTML = construirOptionsLoterias(disponibles, filtroTipoLoteriaNJ);

  // Si la lotería que estaba elegida sigue disponible, la conservamos;
  // si no, el select ya cae en la primera disponible.
  if(disponibles.includes(anterior)) {
    sel.value = anterior;
  } else {
    //  SI CAMBIÓ LA LOTERÍA, RESETEAMOS EL NUMERÓLOGO
    resetearNumerologoNJ();
  }
  
  const sugerida = HORARIOS_LOTERIA[sel.value];
  if(sugerida) document.getElementById('njHoraSorteo').value = sugerida;
}

/* Resetea el estado del Numerólogo en "Nueva jugada". Se llama SIEMPRE
   que se abre el modal o cambia vendedor/fecha/lotería, para que nunca
   quede en pantalla un monto o unos números que en realidad pertenecían
   a la lotería anterior (evita enviar una jugada con el monto o los
   números equivocados). */
/* Qué estrategia de generación se usó para los números que están ahora
   mismo en el modal "Nueva jugada": 'numerologo' (Cargar tipos, o
   escritos a mano — comparten la misma sección de Configuración),
   'numerologoTendencia' (Generar numerólogo) o 'numerologitos'. Se usa
   para saber qué configuración de martingala (activa/nivel máximo,
   sección "Configuración") aplicar al calcular el monto sugerido, y se
   guarda en cada jugada como `estrategiaGeneracion` para que la martingala
   de cada estrategia lleve SU PROPIA racha, separada de las demás. */
let NJ_ESTRATEGIA_ACTUAL = 'numerologo';

function resetearNumerologoNJ(){
  // Limpiar los tipos cargados
  NJ_NUMEROS_POR_TIPO = {};
  
  // Restablecer el mensaje de estado
  const estadoEl = document.getElementById('njTiposEstado');
  if(estadoEl) estadoEl.textContent = 'Elige lotería y fecha, luego toca "Cargar tipos".';
  
  // Limpiar los chips de tipos
  const chipsEl = document.getElementById('njTiposChips');
  if(chipsEl) chipsEl.innerHTML = '';

  // Salir del modo "Generar numerólogo" (tendencia + reparto entre jugadores):
  // una lotería/fecha distinta necesita un cálculo de tendencia nuevo.
  salirModoGeneradoNJ();
  // Vuelve a la estrategia base ("Cargar tipos" / manual) al resetear.
  NJ_ESTRATEGIA_ACTUAL = 'numerologo';
  
  // Limpiar los campos de tipo y números para evitar confusiones
  document.getElementById('njTipo').value = '';
  document.getElementById('njNumeros').value = '';

  // Recalcular el total (0)
  recalcularTotalJugada();
  
  // ✅ RESET SÍNCRONO E INMEDIATO de la lista de montos por jugador: esto
  // pasa ANTES de calcular las nuevas sugerencias (que son asíncronas),
  // así que en ningún momento queda visible en pantalla un monto de la
  // lotería anterior mientras se calcula el nuevo.
  actualizarMontosPorJugadorNJ();

  // Modo Automática: tras limpiar, se recalcula el plan de las loterías marcadas.
  if(NJ_AUTO.activo && typeof autoRefrescarPlan === 'function') autoRefrescarPlan();
}


document.getElementById('btnNuevaJugada').addEventListener('click', ()=>{
  if(VENDEDORES.filter(v=>v.activo!==false).length===0){ toast('Primero crea al menos un jugador activo.', 'danger'); return; }
  document.getElementById('njFecha').value = hoyStr();
  document.getElementById('njTipo').value='';
  document.getElementById('njNumeros').value='';
  document.getElementById('njTotal').value='';
  NJ_JUGADORES_SELECCIONADOS.clear();
  if(typeof autoSalirNJ === 'function') autoSalirNJ(true); // siempre arranca en modo manual

  poblarSelectVendedores(); // repinta el checklist de jugadores (todos desmarcados)
  
  // ✅ RESETEAR EL NUMERÓLOGO AL ABRIR EL MODAL
  resetearNumerologoNJ();
  
  actualizarLoteriasDisponiblesNJ();
  openModal('modalNuevaJugada');
});

document.getElementById('njFecha').addEventListener('change', ()=>{
  actualizarLoteriasDisponiblesNJ();
  // ✅ RESETEAR NUMERÓLOGO AL CAMBIAR DE FECHA
  resetearNumerologoNJ();
});

document.getElementById('njLoteria').addEventListener('change', ()=>{
  const sugerida = HORARIOS_LOTERIA[document.getElementById('njLoteria').value];
  if(sugerida) document.getElementById('njHoraSorteo').value = sugerida;
  // ✅ RESETEAR NUMERÓLOGO AL CAMBIAR DE LOTERÍA
  resetearNumerologoNJ();
});

/* ======================================================================
   FILTRO "UN TIPO DE JUGADA" / "MÁS DE UNA JUGADA": pestañas de "Números"
   y de "Enviar jugada". Ambas arrancan en "Más de una jugada" por
   defecto. Al cambiar el filtro, se re-pobla el select correspondiente y,
   en "Enviar jugada", se resetean Monto/Números/Tipo para no dejar en
   pantalla datos de una lotería que ya no está en la lista filtrada.
   ====================================================================== */
inicializarFiltroTipoLoteria('filtroTipoLoteriaNum', filtroTipoLoteriaNum, (nuevoFiltro)=>{
  filtroTipoLoteriaNum = nuevoFiltro;
  poblarSelectLoterias();
});
inicializarFiltroTipoLoteria('filtroTipoLoteriaNJ', filtroTipoLoteriaNJ, (nuevoFiltro)=>{
  filtroTipoLoteriaNJ = nuevoFiltro;
  actualizarLoteriasDisponiblesNJ();
  resetearNumerologoNJ();
});

/* El total ahora es la suma de lo que se le enviará a CADA jugador
   marcado: cantidad de números x monto por número de ESE jugador.
   En modo "Generar numerólogo" cada jugador tiene su propia porción de
   números (repartidos); en modo normal todos comparten el mismo campo
   "Números". */
function recalcularTotalJugada(){
  let total = 0;
  NJ_JUGADORES_SELECCIONADOS.forEach(usuario=>{
    const monto = NJ_MONTOS_POR_JUGADOR[usuario]?.monto || 0;
    const cantidadNumeros = obtenerNumerosDeJugadorNJ(usuario).length;
    total += cantidadNumeros * monto;
  });
  document.getElementById('njTotal').value = fmtMoney(total);
}
document.getElementById('njNumeros').addEventListener('input', ()=>{
  if(!NJ_MODO_GENERADO) NJ_ESTRATEGIA_ACTUAL = 'numerologo';
  recalcularTotalJugada();
});

/* ======================================================================
   SUGERENCIA AUTOMÁTICA DE "MONTO POR NÚMERO" (estrategia de racha)
   ------------------------------------------------------------------
   La racha es POR JUGADOR: cada vendedor lleva su propio nivel de
   martingala en cada lotería, calculado solo con SUS jugadas — nunca
   mezclado con las de otros jugadores. Así, si hoy agregas un jugador
   nuevo, arranca en modo manual (sin ninguna racha previa), y el nivel
   de martingala de un jugador que ya llevaba varias pérdidas seguidas no
   se ve afectado ni contagiado por lo que le pasó a otro jugador en esa
   misma lotería.

   Al elegir vendedor + lotería en "Nueva jugada", recorremos el HISTORIAL
   de sorteos YA RESUELTOS (con resultado oficial publicado) de esa
   lotería entre las jugadas CONFIRMADAS de ESE jugador, y decidimos el
   monto sugerido así:
     - Si el sorteo MÁS RECIENTE tuvo ganancia neta positiva            -> vuelve a monto manual (racha reiniciada)
     - Si no, ACUMULAMOS la pérdida neta de ese sorteo Y de todos los
       sorteos anteriores consecutivos que también se perdieron (hasta
       toparnos con uno ganador, o con el final del historial). Esa es
       la "racha" completa, no solo el último nivel.
   Si ese jugador no tiene ningún sorteo resuelto todavía en esa
   lotería (por ejemplo, es su primera jugada), se deja en modo manual.

   ------------------------------------------------------------------
   CÁLCULO DEL MONTO (corregido):
   Antes, el monto sugerido solo duplicaba la pérdida del ÚLTIMO sorteo,
   así que si ya llevabas varios niveles de martingala perdidos, el
   siguiente nivel nunca alcanzaba a cubrir los niveles previos — solo
   el más reciente. Además, duplicar a ciegas no garantizaba nada: si el
   acierto llegaba en 3ra (el pago más bajo, x4) el premio ni siquiera
   cubría la propia apuesta de esa ronda.

   Ahora el monto se calcula para que, SI el acierto es en 1ra lugar
   (x60), el dinero cobrado alcance para cubrir:
     pérdida acumulada de TODA la racha + inversión de esta misma ronda
     + un margen de ganancia.
   Si el acierto cae en 2da o 3ra (multiplicador más bajo), la
   recuperación puede ser parcial — eso es un riesgo aceptado, no un bug:
   con el multiplicador de 1ra (x60) se puede jugar una cantidad de
   números mucho más realista que si se exigiera cubrir el peor caso
   (3ra, x4), que solo permitía hasta 3 números por ronda.
   La posición objetivo es ajustable en INDICE_POSICION_OBJETIVO.
   ====================================================================== */
// Tope de escalada por defecto (usado como respaldo si una jugada vieja
// no trae `estrategiaGeneracion`, o si a la sección de Configuración
// todavía no le llegó su primer snapshot). El tope REAL que se aplica es
// el configurado por estrategia en Configuración (GEN_CONFIG.<estrategia>
// .martingalaNivelMaximo, de 1 a 10), leído dentro de la función.
const NIVEL_MAXIMO_MARTINGALA = 4;

async function calcularSugerenciaMontoLoteria(vendedor, loteria, estrategia){
  if(!loteria || !vendedor) return { modo:'manual' };
  estrategia = estrategia || 'numerologo';

  // Cada estrategia (Cargar tipos / Generar numerólogo (tendencia) /
  // Numerologitos) tiene SU PROPIA martingala, activable/desactivable y
  // con SU PROPIO tope de nivel en Configuración — así que la racha de
  // un jugador se calcula SOLO con las jugadas que se generaron con esa
  // misma estrategia (las jugadas viejas, de antes de este cambio, no
  // traen `estrategiaGeneracion` guardado y se tratan como si fueran de
  // "numerologo", que es la estrategia base/histórica de la app).
  const cfgEstrategia = GEN_CONFIG[estrategia] || {};
  const martingalaActiva = cfgEstrategia.martingalaActiva !== false;
  const nivelMaximoConfigurado = Math.min(10, Math.max(1, cfgEstrategia.martingalaNivelMaximo || NIVEL_MAXIMO_MARTINGALA));

  if(!martingalaActiva){
    return {
      modo:'manual',
      nivel:1,
      mensaje: `La martingala está <b>desactivada</b> para la estrategia "${estrategia}" en Configuración — se usa siempre la inversión base para ${vendedor}, sin importar rachas anteriores.`
    };
  }

  // Agrupamos, por sorteo (fecha + hora), SOLO las jugadas ya CONFIRMADAS
  // de este jugador en esta lotería Y esta misma estrategia — la racha
  // de cada jugador es la suya, y cada estrategia lleva la suya propia.
  const grupos = {};
  JUGADAS.filter(j=>j.loteria===loteria && j.vendedor===vendedor && j.estado==='confirmada' && (j.estrategiaGeneracion || 'numerologo')===estrategia).forEach(j=>{
    const key = `${j.fecha}__${j.horaSorteo||''}`;
    (grupos[key] = grupos[key] || []).push(j);
  });

  // Más reciente primero
  const claves = Object.keys(grupos).sort((a,b)=> b.localeCompare(a));

  const MONTO_MINIMO_MARTINGALA = 3; // el monto sugerido nunca baja de esto, sea cual sea la lotería
  // Posición sobre la que garantizamos la recuperación total: 0=1ra, 1=2da, 2=3ra.
  // Si acierta en una posición MEJOR (multiplicador más alto) que esta, recupera de sobra.
  // Si acierta en una posición PEOR (multiplicador más bajo), puede no recuperar todo.
  const INDICE_POSICION_OBJETIVO = 0; // 0 = 1ra lugar (x60)
  const MULTIPLICADOR_OBJETIVO = MULTIPLICADOR_PREMIO[INDICE_POSICION_OBJETIVO];
  const MARGEN_GANANCIA_PCT = 0.15; // % de ganancia extra deseada sobre lo perdido, ajustable

  let perdidaAcumulada = 0;
  let cantidadNumerosRacha = 0;   // cantidad de números de la ronda más reciente en curso
  let fechaMasReciente = null;
  let invertidoTotalRacha = 0, gananciaTotalRacha = 0;
  let hayRachaDePerdida = false;
  let nivelActual = 0;            // cantidad de sorteos perdidos consecutivos contados hasta ahora
  let seSuperoNivelMaximo = false;
  let detalleNivelesRacha = [];   // detalle de cada sorteo perdido dentro del tope (del más reciente al más antiguo), para el aviso al admin

  for(const key of claves){
    const jugadasGrupo = grupos[key];
    const fecha = key.split('__')[0];
    const numerosResultado = await obtenerResultadoOficial(loteria, fecha);
    if(!numerosResultado || numerosResultado.length===0) continue;

    let invertido = 0, gananciaBruta = 0, cantidadNumeros = 0;
    jugadasGrupo.forEach(j=>{
      invertido += (j.montoTotal || 0);
      cantidadNumeros = Math.max(cantidadNumeros, (j.numeros||[]).length);
      const calculo = calcularAciertosJugada(j, numerosResultado);
      if(calculo) gananciaBruta += calculo.monto;
    });

    const perdidaNeta = invertido - gananciaBruta;

    if(perdidaNeta <= 0){
      // Este sorteo se ganó (o quedó en tablas). Si es el más reciente y
      // todavía no veníamos acumulando pérdidas, reinicia la racha entera.
      if(!hayRachaDePerdida){
        return {
          modo:'manual',
          nivel:1,
          invertido,
          gananciaBruta,
          gananciaNeta: -perdidaNeta,
          fecha,
          mensaje: ` Ganancia neta de ${fmtMoney(-perdidaNeta)} en ${fecha}. Racha de ${vendedor} reiniciada — vuelve a <b>Nivel 1</b> (inversión base).`
        };
      }
      // Si ya veníamos acumulando pérdidas de sorteos más recientes, este
      // sorteo ganador marca el INICIO de la racha (tope hacia atrás): dejamos de acumular.
      break;
    }

    // Sorteo perdido → se suma a la pérdida acumulada de la racha completa,
    // pero solo hasta el nivel máximo permitido (configurado por estrategia).
    nivelActual++;
    if(nivelActual > nivelMaximoConfigurado){
      // Ya se contaron los nivelMaximoConfigurado sorteos perdidos más
      // recientes y este sería un nivel de más: dejamos de acumular,
      // esta pérdida y las anteriores a ella quedan fuera de la racha.
      seSuperoNivelMaximo = true;
      break;
    }
    perdidaAcumulada += perdidaNeta;
    invertidoTotalRacha += invertido;
    gananciaTotalRacha += gananciaBruta;
    detalleNivelesRacha.push({ fecha, invertido, gananciaBruta, perdidaNeta });
    if(!hayRachaDePerdida){
      cantidadNumerosRacha = cantidadNumeros; // usamos la cantidad de números de la ronda MÁS RECIENTE
      fechaMasReciente = fecha;
    }
    hayRachaDePerdida = true;
  }

  if(!hayRachaDePerdida){
    // Este jugador no tiene todavía ningún sorteo resuelto en esta lotería con esta estrategia
    return { modo:'manual', nivel:1, mensaje: `${vendedor} no tiene sorteos resueltos todavía en ${loteria} con esta estrategia — arranca en <b>Nivel 1</b> (inversión base). Ingresa el monto manualmente.` };
  }

  if(seSuperoNivelMaximo){
    // El nivel máximo también se perdió (hay un sorteo perdido de más
    // detrás de él en la racha): se corta la escalada aquí y se vuelve a
    // jugar la inversión base, como si la racha empezara de nuevo.

    // detalleNivelesRacha quedó ordenado del más reciente al más antiguo
    // (así se fue recorriendo el historial); lo invertimos para numerar
    // los niveles en el orden real en que se jugaron: Nivel 1 = el primer
    // sorteo perdido de la racha (el más antiguo), Nivel N = el último
    // (el más reciente, el que confirmó que no se recuperó).
    const nivelesCronologicos = detalleNivelesRacha.slice().reverse().map((d, i) => ({ nivel: i+1, ...d }));

    // Aviso al admin por el chat (no bloquea el flujo si falla el envío;
    // ver notificarNivelMaximoMartingalaAdmin más abajo para el dedup).
    notificarNivelMaximoMartingalaAdmin({ vendedor, loteria, estrategia, nivelMaximo: nivelMaximoConfigurado, niveles: nivelesCronologicos, perdidaAcumulada, fechaMasReciente: detalleNivelesRacha[0]?.fecha });

    return {
      modo:'manual',
      nivel:1,
      perdidaAcumulada,
      nivelAlcanzado: nivelMaximoConfigurado,
      mensaje: ` ${vendedor} llegó al <b>Nivel ${nivelMaximoConfigurado}</b> (el máximo permitido para esta estrategia) en ${loteria} sin recuperar (pérdida acumulada de esos ${nivelMaximoConfigurado} sorteos: ${fmtMoney(perdidaAcumulada)}). Se corta la escalada y vuelve a <b>Nivel 1</b> (inversión base de ${fmtMoney(NJ_MONTO_MANUAL_DEFAULT)} por número). Se avisó al admin por el chat.`
    };
  }

  const N = cantidadNumerosRacha || 1;
  const gananciaDeseada = Math.max(perdidaAcumulada * MARGEN_GANANCIA_PCT, MONTO_MINIMO_MARTINGALA);

  let nuevoMontoPorNumero;
  let advertencia = '';

  if(MULTIPLICADOR_OBJETIVO > N){
    // Se puede garantizar la recuperación total si el acierto es en la
    // posición objetivo (1ra, x60): despejamos "m" de
    //   m*MULTIPLICADOR_OBJETIVO - m*N  >=  perdidaAcumulada + gananciaDeseada
    nuevoMontoPorNumero = Math.ceil((perdidaAcumulada + gananciaDeseada) / (MULTIPLICADOR_OBJETIVO - N));
  } else {
    // Con esta cantidad de números, un solo acierto en 1ra (x60) tampoco
    // alcanza para cubrir ni la apuesta de esta misma ronda —
    // matemáticamente no hay monto que garantice recuperación. Usamos el
    // criterio anterior (duplicar) como mejor esfuerzo y avisamos.
    nuevoMontoPorNumero = Math.ceil((perdidaAcumulada * 2) / N);
    advertencia = ` ⚠️ Con ${N} números jugados, un acierto en 1ra (x${MULTIPLICADOR_OBJETIVO}) no alcanza matemáticamente para cubrir ni la apuesta de esta ronda. Para que la martingala pueda garantizar recuperación, hay que jugar menos de ${MULTIPLICADOR_OBJETIVO} números por ronda.`;
  }

  if(nuevoMontoPorNumero < MONTO_MINIMO_MARTINGALA) nuevoMontoPorNumero = MONTO_MINIMO_MARTINGALA;

  // El nivel de ESTA sugerencia es "cuántos sorteos perdidos consecutivos
  // hay hasta ahora, + 1" (la próxima apuesta que se está por hacer).
  // Como nivelActual nunca pasa de nivelMaximoConfigurado (ver el corte
  // más arriba), el nivel sugerido siempre queda entre 2 y ese tope.
  const nivelSugerido = Math.min(nivelActual + 1, nivelMaximoConfigurado);

  return {
    modo:'auto',
    monto: nuevoMontoPorNumero,
    invertido: invertidoTotalRacha,
    gananciaBruta: gananciaTotalRacha,
    perdidaNeta: perdidaAcumulada,
    perdidaAcumulada,
    gananciaDeseada,
    fecha: fechaMasReciente,
    cantidadNumeros: N,
    nivel: nivelSugerido,
    mensaje: ` Racha activa de <b>${vendedor}</b> en <b>${loteria}</b> — <b>Nivel ${nivelSugerido} de ${nivelMaximoConfigurado}</b> de martingala: pérdida acumulada de <b>${fmtMoney(perdidaAcumulada)}</b> en la racha completa. Monto sugerido para cubrir todo lo perdido + ${fmtMoney(gananciaDeseada)} de ganancia si acierta en 1ra lugar: <b>${fmtMoney(nuevoMontoPorNumero)}</b> por número.${advertencia} (Si acierta en 2da o 3ra, la recuperación puede ser parcial.)`
  };
}

/* Evita reenviar la misma alerta de "nivel máximo de martingala
   alcanzado" una y otra vez cada vez que el admin abre o refresca el
   modal "Nueva jugada" mientras siga siendo exactamente la misma racha
   (mismo jugador + lotería + fecha del sorteo más reciente de esa
   racha). Si más adelante aparece un sorteo nuevo (la racha avanza o se
   corta de nuevo), la clave cambia y se puede volver a avisar. */
const MARTINGALA_NIVEL_MAX_ALERTADO = new Set();

/* Publica en el chat grupal (admin + jugadores), como mensaje de rol
   "sistema", el detalle completo de por qué se cortó la escalada de
   martingala: cada uno de los 4 niveles perdidos (fecha, invertido,
   ganado y pérdida neta de cada uno) más el total perdido en la racha.
   Si falla el envío no interrumpe nada más (la sugerencia ya se calculó
   y se le mostró al admin; esto es solo la notificación). */
async function notificarNivelMaximoMartingalaAdmin({ vendedor, loteria, estrategia, nivelMaximo, niveles, perdidaAcumulada, fechaMasReciente }){
  const key = `${vendedor}__${loteria}__${estrategia || ''}__${fechaMasReciente || ''}`;
  if(MARTINGALA_NIVEL_MAX_ALERTADO.has(key)) return; // ya se avisó de esta misma racha
  MARTINGALA_NIVEL_MAX_ALERTADO.add(key);
  const nivelTope = nivelMaximo || NIVEL_MAXIMO_MARTINGALA;
  try{
    const vend = VENDEDORES.find(v=>v.usuario===vendedor);
    const nombreVend = vend ? vend.nombre : vendedor;
    const detalleLineas = niveles
      .map(n => `• Nivel ${n.nivel} — ${n.fecha}: invirtió ${fmtMoney(n.invertido)}, ganó ${fmtMoney(n.gananciaBruta)} → pérdida neta ${fmtMoney(n.perdidaNeta)}`)
      .join('\n');

    const texto =
      ` ALERTA: NIVEL MÁXIMO DE MARTINGALA ALCANZADO\n` +
      `${nombreVend} llegó al Nivel ${nivelTope} en ${loteria} (estrategia: ${estrategia || 'numerologo'}) sin recuperar. Se cortó la escalada automáticamente y la próxima jugada sugerida vuelve a Nivel 1 (inversión base de ${fmtMoney(NJ_MONTO_MANUAL_DEFAULT)} por número).\n\n` +
      `Detalle de los ${niveles.length} niveles perdidos:\n${detalleLineas}\n\n` +
      `Total perdido en la racha: ${fmtMoney(perdidaAcumulada)}`;

    await db.collection(COL_CHAT).add({
      autor: CURRENT_USER.usuario,
      autorNombre: CURRENT_USER.nombre || CURRENT_USER.usuario,
      rol: 'sistema',
      texto,
      audioUrl: null,
      audioDuracionSeg: null,
      fecha: firebase.firestore.FieldValue.serverTimestamp(),
    });
  }catch(err){
    console.error('No se pudo notificar al admin sobre el nivel máximo de martingala:', err);
    MARTINGALA_NIVEL_MAX_ALERTADO.delete(key); // permite reintentar si falló el envío
  }
}

/* Monto manual por defecto cuando un jugador NO tiene racha activa
   (sin pérdidas pendientes de cubrir) en la lotería elegida. */
const NJ_MONTO_MANUAL_DEFAULT = 5;

// Montos calculados/editados por jugador para el envío actual:
// { usuario: { monto, modo:'auto'|'manual', mensaje, editadoManual } }
let NJ_MONTOS_POR_JUGADOR = {};
let NJ_MONTOS_REQUEST_ID = 0;

function renderFilaMontoNJ(usuario, calculando){
  const vend = VENDEDORES.find(v=>v.usuario===usuario);
  const nombre = vend ? vend.nombre : usuario;
  const datos = NJ_MONTOS_POR_JUGADOR[usuario];

  if(calculando || !datos){
    return `
      <div class="nj-monto-row calculando" data-usuario="${usuario}">
        <div class="nj-monto-row-head"><span class="nombre">${nombre}</span></div>
        <div class="nj-monto-hint">Calculando su racha en esta lotería...</div>
      </div>`;
  }

  const badge = datos.modo === 'auto'
    ? `<span class="badge-modo auto">Martingala · Nivel ${datos.nivel || '?'}</span>`
    : `<span class="badge-modo manual">Manual${datos.nivel ? ' · Nivel ' + datos.nivel : ''}</span>`;

  // Modo "Generar numerólogo": cada jugador tiene su propia porción de
  // números repartidos, se muestra debajo del nombre.
  const numerosDelJugador = obtenerNumerosDeJugadorNJ(usuario);
  const lineaNumeros = NJ_MODO_GENERADO
    ? `<div class="nj-monto-numeros">Le tocan <b>${numerosDelJugador.length}</b> número${numerosDelJugador.length===1?'':'s'}: <span class="mono">${numerosDelJugador.join(', ') || '—'}</span></div>`
    : '';

  // Aviso informativo (no bloquea el envío): si el saldo actual del
  // jugador no alcanza para cubrir esta jugada, el admin lo ve de una
  // vez. El bloqueo real ocurre cuando el jugador intenta CONFIRMAR el
  // ticket físico (ahí sí se le impide jugar sin saldo suficiente).
  const totalDelJugador = numerosDelJugador.length * (datos.monto || 0);
  const saldoDelJugador = vend ? (vend.saldo || 0) : null;
  const avisoSaldo = (saldoDelJugador !== null && totalDelJugador > 0 && saldoDelJugador < totalDelJugador)
    ? `<div class="nj-monto-aviso-saldo">⚠️ Saldo insuficiente: tiene ${fmtMoney(saldoDelJugador)}, esta jugada le costaría ${fmtMoney(totalDelJugador)}. No podrá confirmarla hasta depositar.</div>`
    : '';

  return `
    <div class="nj-monto-row" data-usuario="${usuario}">
      <div class="nj-monto-row-head"><span class="nombre">${nombre}</span>${badge}</div>
      ${lineaNumeros}
      <input type="number" class="nj-monto-input" min="1" data-usuario="${usuario}" value="${datos.monto}" />
      <div class="nj-monto-hint">${datos.mensaje || ''}</div>
      ${avisoSaldo}
    </div>`;
}

/* Re-pinta la lista de montos con los datos que YA están calculados en
   NJ_MONTOS_POR_JUGADOR (sin volver a consultar Firestore). Se usa
   cuando lo que cambió fue el reparto de números (modo generado) y no
   hace falta recalcular la martingala de nadie. */
function rerenderMontosPorJugadorNJ(){
  const wrap = document.getElementById('njMontosPorJugador');
  if(!wrap) return;
  const jugadores = Array.from(NJ_JUGADORES_SELECCIONADOS);
  if(jugadores.length === 0){
    wrap.innerHTML = '<div class="small-muted" id="njMontosVacio" style="padding:10px 2px;">Selecciona al menos un jugador y una lotería para ver los montos.</div>';
    return;
  }
  wrap.innerHTML = jugadores.map(u => renderFilaMontoNJ(u, !NJ_MONTOS_POR_JUGADOR[u])).join('');
}

/* Recalcula, para CADA jugador marcado en el checklist, su monto
   sugerido por número según su propia martingala en la lotería elegida
   (en paralelo). Si un jugador no tiene racha activa, se le deja el
   monto manual por defecto (RD$5), editable en su propia fila —sin
   afectar el monto de los demás jugadores seleccionados. */
async function actualizarMontosPorJugadorNJ(){
  const loteria = document.getElementById('njLoteria').value;
  const wrap = document.getElementById('njMontosPorJugador');
  if(!wrap) return;
  const jugadores = Array.from(NJ_JUGADORES_SELECCIONADOS);

  // Los jugadores que ya no están marcados no deben conservar monto guardado
  Object.keys(NJ_MONTOS_POR_JUGADOR).forEach(u=>{
    if(!NJ_JUGADORES_SELECCIONADOS.has(u)) delete NJ_MONTOS_POR_JUGADOR[u];
  });

  if(jugadores.length === 0 || !loteria){
    wrap.innerHTML = '<div class="small-muted" id="njMontosVacio" style="padding:10px 2px;">Selecciona al menos un jugador y una lotería para ver los montos.</div>';
    recalcularTotalJugada();
    return;
  }

  // Feedback inmediato: fila "calculando..." para el jugador que aún no tenga monto
  rerenderMontosPorJugadorNJ();
  recalcularTotalJugada();

  const requestId = ++NJ_MONTOS_REQUEST_ID;
  try{
    const resultados = await Promise.all(jugadores.map(u => calcularSugerenciaMontoLoteria(u, loteria, NJ_ESTRATEGIA_ACTUAL)));
    // Si mientras calculábamos el admin cambió de lotería/fecha/jugadores, descartamos este resultado viejo
    if(requestId !== NJ_MONTOS_REQUEST_ID) return;

    jugadores.forEach((usuario, i)=>{
      const sug = resultados[i];
      if(sug.modo === 'auto'){
        NJ_MONTOS_POR_JUGADOR[usuario] = { monto: sug.monto, modo:'auto', mensaje: sug.mensaje, nivel: sug.nivel || null };
      } else {
        const previo = NJ_MONTOS_POR_JUGADOR[usuario];
        NJ_MONTOS_POR_JUGADOR[usuario] = {
          // Si el admin ya había tocado el monto manual de este jugador, se respeta
          monto: (previo && previo.modo === 'manual' && previo.editadoManual) ? previo.monto : NJ_MONTO_MANUAL_DEFAULT,
          modo: 'manual',
          mensaje: sug.mensaje || 'Sin historial todavía. Monto manual por defecto (puedes cambiarlo).',
          nivel: sug.nivel || 1
        };
      }
    });

    rerenderMontosPorJugadorNJ();
    recalcularTotalJugada();
  }catch(err){
    console.error('Error calculando montos por jugador:', err);
    if(requestId === NJ_MONTOS_REQUEST_ID){
      jugadores.forEach(usuario=>{
        if(!NJ_MONTOS_POR_JUGADOR[usuario]){
          NJ_MONTOS_POR_JUGADOR[usuario] = { monto: NJ_MONTO_MANUAL_DEFAULT, modo:'manual', mensaje: 'No se pudo calcular la sugerencia automática. Ingresa el monto manualmente.' };
        }
      });
      rerenderMontosPorJugadorNJ();
      recalcularTotalJugada();
    }
  }
}

// Delegación: el admin edita a mano el monto de UN jugador sin afectar a los demás
document.getElementById('njMontosPorJugador').addEventListener('input', (e)=>{
  if(!e.target.classList.contains('nj-monto-input')) return;
  const usuario = e.target.dataset.usuario;
  const valor = Number(e.target.value) || 0;
  if(!NJ_MONTOS_POR_JUGADOR[usuario]) NJ_MONTOS_POR_JUGADOR[usuario] = { modo:'manual' };
  NJ_MONTOS_POR_JUGADOR[usuario].monto = valor;
  NJ_MONTOS_POR_JUGADOR[usuario].editadoManual = true;
  recalcularTotalJugada();
});

/* --- "Cargar tipos" dentro de Nueva Jugada: GENERA los números de cada
   tipo de jugada de la lotería elegida (ya NO los busca en Firestore —
   main.py no guarda números, solo resultados oficiales). Usa el mismo
   motor y la misma configuración ("Configuración → Numerólogo") que
   "Números → Numerólogo", así que da exactamente el mismo resultado. --- */
let NJ_NUMEROS_POR_TIPO = {};
document.getElementById('btnCargarTiposNJ').addEventListener('click', async ()=>{
  const loteria = document.getElementById('njLoteria').value;
  const fecha = document.getElementById('njFecha').value;
  const estadoEl = document.getElementById('njTiposEstado');
  const chipsEl = document.getElementById('njTiposChips');
  if(!loteria || !fecha){ toast('Elige lotería y fecha primero.', 'danger'); return; }
  NJ_ESTRATEGIA_ACTUAL = 'numerologo';
  actualizarMontosPorJugadorNJ(); // recalcula con la martingala de "Cargar tipos"
  estadoEl.textContent = 'Generando con el Numerólogo...';
  chipsEl.innerHTML = '';
  try{
    const info = CATALOGO_LOTERIAS[loteria];
    const esUnica = !!info?.esUnica;
    const tipos = esUnica ? [loteria] : ((info?.tipos && info.tipos.length) ? info.tipos : ['GANAR 85% SEGURO','TRIPLETAS','PALE','QUINIELA']);

    NJ_NUMEROS_POR_TIPO = {};
    for(const tipo of tipos){
      const resultado = await genNumerosParaTipo(loteria, tipo);
      if(resultado.sinHistorial){
        estadoEl.textContent = `Todavía no hay resultados oficiales guardados para ${loteria}. El Numerólogo necesita historial para generar números.`;
        NJ_NUMEROS_POR_TIPO = {};
        return;
      }
      NJ_NUMEROS_POR_TIPO[tipo] = resultado.numeros;
    }

    const seleccionarTipo = (tipo, chipEl)=>{
      document.querySelectorAll('.nj-tipo-chip').forEach(c=>c.classList.remove('active'));
      if(chipEl) chipEl.classList.add('active');
      document.getElementById('njTipo').value = tipo;
      // En modo "Generar numerólogo" los números ya están calculados y
      // repartidos entre los jugadores; el chip solo presta el nombre
      // del tipo de jugada, sin tocar los números.
      if(NJ_MODO_GENERADO) return;
      const numeros = NJ_NUMEROS_POR_TIPO[tipo] || [];
      document.getElementById('njNumeros').value = numeros.join(', ');
      recalcularTotalJugada();
    };

    // ✅ Lotería de UN SOLO tipo de jugada (LOTOMAS, KINO, LOTO_POOL,
    // LOTO_REAL...): no tiene sentido pedirle al admin que elija entre
    // chips si solo hay un tipo posible, así que se autoselecciona.
    if(esUnica){
      const tipo = tipos[0];
      chipsEl.innerHTML = `<div class="filter-tab nj-tipo-chip active" data-tipo="${tipo}">${tipo}</div>`;
      estadoEl.textContent = `${loteria} es una lotería de un solo tipo de jugada — números generados automáticamente.`;
      seleccionarTipo(tipo, chipsEl.querySelector('.nj-tipo-chip'));
      return;
    }

    estadoEl.textContent = 'Toca el tipo de jugada que vas a enviar:';
    chipsEl.innerHTML = tipos.map(t=>`<div class="filter-tab nj-tipo-chip" data-tipo="${t}">${t}</div>`).join('');
    document.querySelectorAll('.nj-tipo-chip').forEach(chip=>{
      chip.addEventListener('click', ()=> seleccionarTipo(chip.dataset.tipo, chip));
    });
  }catch(err){
    console.error(err);
    estadoEl.textContent = 'Error al generar: ' + err.message;
  }
});

/* ======================================================================
   GENERAR NUMERÓLOGO (tendencia alto/bajo, calculado aquí mismo)
   ------------------------------------------------------------------
   A diferencia de "Cargar tipos" (que genera un pool por CADA tipo de
   jugada con el motor general del Numerólogo), "Generar numerólogo"
   calcula al vuelo, con SU PROPIO método más simple, sin guardar nada en
   la base de datos:
     1) Trae el historial COMPLETO de resultados oficiales de la lotería
        elegida (colección loterias/{loteria}/resultados), del más
        reciente al más antiguo, sin incluir la fecha que se va a jugar.
     2) Toma los últimos N sorteos (N = "sorteos para tendencia", ver
        Configuración → Generar numerólogo (tendencia)) y mira el PRIMER
        PREMIO de cada uno para determinar la tendencia:
          • ALTO: 50 al 99, más el 00 (que equivale al 100)
          • BAJO: 01 al 49
        Gana el lado con más apariciones entre esos primeros premios.
     3) Se arma el set completo de números del lado ganador (51 números
        si es ALTO, 49 si es BAJO) y, recorriendo el historial del más
        reciente al más antiguo, se le van quitando los números que
        salieron como primer premio y pertenecen a ese mismo lado, hasta
        dejar la "cantidad objetivo" configurada (por defecto 40).
   Esos números se reparten entre los jugadores marcados (como
   "dar cartas": uno para cada uno por turno) y cada jugador sigue
   recibiendo SU PROPIO monto según SU propia martingala — igual que en
   el flujo normal.
   ====================================================================== */
let NJ_MODO_GENERADO = false;               // ¿está activo el reparto por tendencia?
let NJ_GENERADO_INFO = null;                 // { lado, votos:{alto,bajo}, numeros, sorteosUsados, sorteosHistorial }
let NJ_NUMEROS_GENERADOS_POR_JUGADOR = {};   // { usuario: [numeros asignados a ese jugador] }

/* 00 cuenta como "100" -> lado ALTO. 50-99 -> ALTO. 01-49 -> BAJO. */
function claseLadoNumero(numero){
  const n = Number(numero);
  if(Number.isNaN(n)) return null;
  if(n === 0) return 'alto';
  if(n >= 50 && n <= 99) return 'alto';
  if(n >= 1 && n <= 49) return 'bajo';
  return null;
}
function todosLosNumerosDelLado(lado){
  const nums = [];
  if(lado === 'alto'){
    for(let i=50;i<=99;i++) nums.push(String(i).padStart(2,'0'));
    nums.push('00');
  } else {
    for(let i=1;i<=49;i++) nums.push(String(i).padStart(2,'0'));
  }
  return nums;
}
/* Historial completo de resultados oficiales de una lotería, del más
   reciente al más antiguo, sin incluir (ni pasar de) la fecha del
   sorteo que se está por jugar. */
async function obtenerHistorialCompletoLoteria(loteria, antesDeFecha){
  // OJO: se evita a propósito usar .where()/.orderBy() sobre
  // FieldPath.documentId() en esta subcolección, porque Firestore pide
  // crear un índice compuesto para esa combinación. Como "resultados"
  // guarda como mucho un documento por día, es perfectamente barato
  // traerla completa y filtrar/ordenar aquí mismo, sin depender de
  // ningún índice adicional en la consola de Firebase.
  const snap = await db.collection('loterias').doc(loteria).collection('resultados').get();
  let docs = snap.docs.map(d => ({ fecha: d.id, numeros: d.data().numeros || [] }));
  if(antesDeFecha) docs = docs.filter(d => d.fecha < antesDeFecha);
  docs.sort((a,b) => b.fecha.localeCompare(a.fecha)); // más reciente primero
  return docs;
}
/* Aplica el método descrito arriba sobre un historial ya obtenido.
   Los parámetros (sorteos para tendencia y cantidad objetivo) salen de
   Configuración → "Generar numerólogo (tendencia)" — ver GEN_CONFIG. */
function generarNumerosNumerologoDeTendencia(historial){
  if(!historial || historial.length === 0) return null;
  const cfg = GEN_CONFIG.numerologoTendencia;
  const sorteosTendencia = cfg.sorteosTendencia || 3;
  const cantidadObjetivo = cfg.cantidadObjetivo || 40;

  const ultimosN = historial.slice(0, sorteosTendencia);
  let votosAlto = 0, votosBajo = 0;
  ultimosN.forEach(sorteo=>{
    const lado = claseLadoNumero(sorteo.numeros && sorteo.numeros[0]);
    if(lado === 'alto') votosAlto++;
    else if(lado === 'bajo') votosBajo++;
  });
  if(votosAlto === 0 && votosBajo === 0) return null;

  const ladoGanador = votosAlto >= votosBajo ? 'alto' : 'bajo';
  let disponibles = todosLosNumerosDelLado(ladoGanador);

  // Recorremos el historial completo (del más reciente al más antiguo)
  // quitando los primeros premios de ese mismo lado, hasta dejar la
  // cantidad objetivo configurada.
  for(const sorteo of historial){
    if(disponibles.length <= cantidadObjetivo) break;
    const primerPremio = sorteo.numeros && sorteo.numeros[0];
    if(primerPremio === undefined || primerPremio === null) continue;
    const normalizado = String(primerPremio).trim().padStart(2,'0');
    if(claseLadoNumero(normalizado) !== ladoGanador) continue;
    const idx = disponibles.indexOf(normalizado);
    if(idx !== -1) disponibles.splice(idx, 1);
  }
  // Si el historial no alcanzó para bajar a la cantidad exacta, se
  // recorta al tamaño exacto pedido (caso raro: lotería con poco
  // historial aún).
  if(disponibles.length > cantidadObjetivo) disponibles = disponibles.slice(0, cantidadObjetivo);

  return {
    lado: ladoGanador,
    votos: { alto: votosAlto, bajo: votosBajo },
    numeros: disponibles,
    sorteosUsados: ultimosN.length,
    sorteosHistorial: historial.length,
  };
}
/* Reparte NJ_GENERADO_INFO.numeros entre los jugadores marcados, "como
   dar cartas": uno para cada jugador por turno, así la diferencia entre
   lo que recibe cada uno nunca es mayor a un número. */
function redistribuirNumerosGeneradosNJ(){
  NJ_NUMEROS_GENERADOS_POR_JUGADOR = {};
  if(!NJ_MODO_GENERADO || !NJ_GENERADO_INFO) return;
  const jugadores = Array.from(NJ_JUGADORES_SELECCIONADOS);
  if(jugadores.length === 0) return;
  jugadores.forEach(u => NJ_NUMEROS_GENERADOS_POR_JUGADOR[u] = []);
  NJ_GENERADO_INFO.numeros.forEach((numero, i)=>{
    const usuario = jugadores[i % jugadores.length];
    NJ_NUMEROS_GENERADOS_POR_JUGADOR[usuario].push(numero);
  });
}
/* Sale del modo "Generar numerólogo": vuelve a dejar "Números" como
   campo manual/de "Cargar tipos" de siempre. */
function salirModoGeneradoNJ(){
  NJ_MODO_GENERADO = false;
  NJ_GENERADO_INFO = null;
  NJ_NUMEROS_GENERADOS_POR_JUGADOR = {};
  NJ_ESTRATEGIA_ACTUAL = 'numerologo';
  const numerosInput = document.getElementById('njNumeros');
  if(numerosInput) numerosInput.disabled = false;
  const box = document.getElementById('njGeneradoBox');
  if(box) box.style.display = 'none';
}
/* Devuelve los números que le tocan a UN jugador para la jugada actual:
   su porción del reparto (modo generado) o los del campo compartido
   "Números" (modo normal/manual/Cargar tipos). */
function obtenerNumerosDeJugadorNJ(usuario){
  if(NJ_MODO_GENERADO) return NJ_NUMEROS_GENERADOS_POR_JUGADOR[usuario] || [];
  return document.getElementById('njNumeros').value.split(',').map(s=>s.trim()).filter(Boolean);
}

/* ======================================================================
   NUMEROLOGUITOS (otra forma de generar números, mismo flujo de reparto)
   ------------------------------------------------------------------
   Diferencias con "Generar numerólogo (tendencia)":
     1) La tendencia (alto/bajo) se determina SOLO con el primer premio
        del sorteo MÁS RECIENTE (no con el voto de varios sorteos).
     2) Del set completo del lado ganador (51 si alto, 49 si bajo) se
        excluyen los números que salieron en 1ra, 2da o 3ra posición, en
        cualquiera de los últimos N sorteos ("sorteos a excluir", ver
        Configuración → Numerologitos), siempre que pertenezcan a ese
        mismo lado.
     3) Si después de excluir quedan más que la "cantidad objetivo"
        configurada (por defecto 20), se recorta el excedente sacando los
        "más fríos": se cuenta cuántas veces salió cada número (en
        1ra/2da/3ra, en todo el historial disponible) y se eliminan
        primero los que menos (o casi nunca) han salido.
   El resultado se reparte entre los jugadores marcados exactamente igual
   que "Generar numerólogo" (ver redistribuirNumerosGeneradosNJ): por eso
   reutiliza la misma estructura { lado, numeros, ... } y las mismas
   variables NJ_MODO_GENERADO / NJ_GENERADO_INFO.
   ====================================================================== */
function generarNumerosNumerologuitos(historial){
  if(!historial || historial.length === 0) return null;
  const cfg = GEN_CONFIG.numerologitos;
  const sorteosExclusion = cfg.sorteosExclusion || 10;
  const cantidadObjetivo = cfg.cantidadObjetivo || 20;

  // 1) Tendencia según SOLO el sorteo más reciente.
  const masReciente = historial[0];
  const ladoGanador = claseLadoNumero(masReciente.numeros && masReciente.numeros[0]);
  if(!ladoGanador) return null;

  let disponibles = todosLosNumerosDelLado(ladoGanador);

  // 2) Excluir del lado ganador lo que salió en 1ra/2da/3ra en los
  //    últimos N sorteos (configurable).
  const ultimosN = historial.slice(0, sorteosExclusion);
  ultimosN.forEach(sorteo=>{
    (sorteo.numeros || []).slice(0,3).forEach(premio=>{
      if(premio === undefined || premio === null) return;
      const normalizado = String(premio).trim().padStart(2,'0');
      if(claseLadoNumero(normalizado) !== ladoGanador) return;
      const idx = disponibles.indexOf(normalizado);
      if(idx !== -1) disponibles.splice(idx, 1);
    });
  });

  // 3) Si sobran más que la cantidad objetivo, recortar el excedente
  //    sacando los más fríos (menor frecuencia de aparición en
  //    1ra/2da/3ra en TODO el historial).
  if(disponibles.length > cantidadObjetivo){
    const frecuencia = {};
    disponibles.forEach(n => frecuencia[n] = 0);
    historial.forEach(sorteo=>{
      (sorteo.numeros || []).slice(0,3).forEach(premio=>{
        if(premio === undefined || premio === null) return;
        const normalizado = String(premio).trim().padStart(2,'0');
        if(normalizado in frecuencia) frecuencia[normalizado]++;
      });
    });
    disponibles = disponibles
      .map((numero, idx) => ({ numero, idx, freq: frecuencia[numero] }))
      .sort((a,b) => (b.freq - a.freq) || (a.idx - b.idx)) // más "calientes" primero; empate = orden original
      .slice(0, cantidadObjetivo)
      .map(x => x.numero);
  }

  return {
    lado: ladoGanador,
    numeroBase: String(masReciente.numeros && masReciente.numeros[0]).trim().padStart(2,'0'),
    numeros: disponibles,
    sorteosExcluidos: ultimosN.length,
    cantidadObjetivo,
    sorteosHistorial: historial.length,
  };
}

/* Handler genérico para "Generar numerólogo" y "Numerologuitos": ambos
   traen el historial, calculan un set de números con SU propio método
   (generadorFn) y lo reparten entre los jugadores marcados de la misma
   forma. `textoEstado(resultado)` arma el mensaje propio de cada método. */
async function ejecutarGeneracionNJ(btn, generadorFn, estrategiaId, textoEstado){
  const loteria = document.getElementById('njLoteria').value;
  const fecha = document.getElementById('njFecha').value;
  const box = document.getElementById('njGeneradoBox');
  const estado = document.getElementById('njGeneradoEstado');
  if(!loteria || !fecha){ toast('Elige lotería y fecha primero.', 'danger'); return; }
  if(NJ_JUGADORES_SELECCIONADOS.size === 0){ toast('Marca primero a los jugadores entre los que se repartirán los números.', 'danger'); return; }

  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = 'Calculando...';
  box.style.display = 'block';
  estado.textContent = 'Consultando el historial de resultados y calculando la tendencia...';

  try{
    const historial = await obtenerHistorialCompletoLoteria(loteria, fecha);
    if(historial.length === 0){
      salirModoGeneradoNJ();
      estado.textContent = `No hay historial de resultados oficiales guardado para ${loteria}. No se puede calcular la tendencia todavía.`;
      return;
    }
    const resultado = generadorFn(historial);
    if(!resultado || resultado.numeros.length === 0){
      salirModoGeneradoNJ();
      estado.textContent = 'No se pudo determinar una tendencia válida con el historial disponible.';
      return;
    }

    NJ_GENERADO_INFO = resultado;
    NJ_MODO_GENERADO = true;
    NJ_ESTRATEGIA_ACTUAL = estrategiaId;
    document.getElementById('njTipo').value = document.getElementById('njTipo').value || '';

    const numInput = document.getElementById('njNumeros');
    numInput.value = resultado.numeros.join(', ');
    numInput.disabled = true;

    redistribuirNumerosGeneradosNJ();

    estado.innerHTML = textoEstado(resultado);

    recalcularTotalJugada();
    actualizarMontosPorJugadorNJ(); // recalcula con la martingala de esta estrategia (estrategiaId)
  }catch(err){
    console.error('Error generando números:', err);
    estado.textContent = 'Error al generar los números: ' + err.message;
  }finally{
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

document.getElementById('btnGenerarNumerologuitos').addEventListener('click', ()=>{
  const btn = document.getElementById('btnGenerarNumerologuitos');
  ejecutarGeneracionNJ(btn, generarNumerosNumerologuitos, 'numerologitos', (resultado)=>{
    const ladoTxt = resultado.lado === 'alto' ? 'ALTO (50 al 99, más el 00)' : 'BAJO (01 al 49)';
    const avisoIncompleto = resultado.numeros.length < resultado.cantidadObjetivo
      ? ` (quedaron ${resultado.numeros.length} porque los últimos ${resultado.sorteosExcluidos} sorteos ya excluyeron el resto de ese lado)`
      : '';
    return `
      Tendencia detectada (último sorteo): <b>${ladoTxt}</b> — primer premio más reciente: ${resultado.numeroBase}.<br>
      Se excluyeron del lado ganador los números salidos en 1ra/2da/3ra de los últimos ${resultado.sorteosExcluidos} sorteos${resultado.numeros.length===resultado.cantidadObjetivo ? ', y se recortaron los más fríos hasta dejar' : ', quedando'} <b>${resultado.numeros.length} números</b>${avisoIncompleto}, repartidos entre los ${NJ_JUGADORES_SELECCIONADOS.size} jugador(es) marcados — cada uno con su propia parte y su propia martingala. Escribe o carga el <b>tipo de jugada</b> abajo; el campo "Números" quedó bloqueado porque cada jugador recibe una parte distinta (ver el detalle en "Monto por número"). <span class="small-muted">(Parámetros editables en Configuración → Numerologitos)</span>
    `;
  });
});

document.getElementById('btnGenerarNumerologo').addEventListener('click', ()=>{
  const btn = document.getElementById('btnGenerarNumerologo');
  ejecutarGeneracionNJ(btn, generarNumerosNumerologoDeTendencia, 'numerologoTendencia', (resultado)=>{
    const ladoTxt = resultado.lado === 'alto' ? 'ALTO (50 al 99, más el 00)' : 'BAJO (01 al 49)';
    const cantidadObjetivo = GEN_CONFIG.numerologoTendencia.cantidadObjetivo || 40;
    const avisoIncompleto = resultado.numeros.length < cantidadObjetivo
      ? ` (solo se pudieron dejar ${resultado.numeros.length} por falta de historial suficiente)`
      : '';
    return `
      Tendencia detectada: <b>${ladoTxt}</b> — ${resultado.votos.alto} de los últimos ${resultado.sorteosUsados} primeros premios en alto, ${resultado.votos.bajo} en bajo.<br>
      Se generaron <b>${resultado.numeros.length} números</b>${avisoIncompleto}, repartidos entre los ${NJ_JUGADORES_SELECCIONADOS.size} jugador(es) marcados — cada uno con su propia parte y su propia martingala. Escribe o carga el <b>tipo de jugada</b> abajo; el campo "Números" quedó bloqueado porque cada jugador recibe una parte distinta (ver el detalle en "Monto por número"). <span class="small-muted">(Parámetros editables en Configuración → Generar numerólogo (tendencia))</span>
    `;
  });
});

/* Normaliza una lista de números para poder compararla sin que importe
   el orden en que fueron escritos ("05,18,27" == "27, 05, 18"). */
function normalizarNumerosParaComparar(numeros){
  return (numeros || []).map(n=>String(n).trim().toUpperCase()).filter(Boolean).sort().join(',');
}
/* Evita que el admin envíe al mismo vendedor una jugada ya enviada:
   misma lotería, misma fecha de sorteo, mismo tipo y mismos números.
   Las jugadas rechazadas no cuentan (una corrección sí se puede reenviar). */
function existeJugadaDuplicada({ vendedor, loteria, fecha, tipoJugada, numeros }){
  const numerosNorm = normalizarNumerosParaComparar(numeros);
  return JUGADAS.some(j =>
    j.vendedor === vendedor &&
    j.loteria === loteria &&
    j.fecha === fecha &&
    (j.tipoJugada || '').trim().toLowerCase() === tipoJugada.trim().toLowerCase() &&
    normalizarNumerosParaComparar(j.numeros) === numerosNorm &&
    j.estado !== 'rechazada'
  );
}
/* Una vez que YA se envió alguna jugada para esta lotería + fecha + hora
   de sorteo (aunque sea a un solo jugador), esa lotería/sorteo queda
   BLOQUEADA para enviar a cualquier otro jugador — ya sea la misma
   jugada u otra distinta. Todos los jugadores que van a participar en
   esa lotería/sorteo deben quedar marcados juntos en ese primer envío,
   para que se reparta entre todos de una sola vez. Las rechazadas no
   cuentan (si la única jugada de ese sorteo fue rechazada, se libera y
   se puede volver a enviar). */
function existeLoteriaYaEnviada({ loteria, fecha, horaSorteo }){
  return JUGADAS.some(j =>
    j.loteria === loteria &&
    j.fecha === fecha &&
    (j.horaSorteo || '') === (horaSorteo || '') &&
    j.estado !== 'rechazada'
  );
}
/* Envía la MISMA jugada (lotería, tipo, números, sorteo) a TODOS los
   jugadores marcados en el checklist, pero cada uno con SU PROPIO monto
   por número (calculado según su martingala, o el manual que el admin
   haya dejado/editado en su fila). Si a algún jugador del grupo ya se
   le había enviado exactamente esa misma jugada, se le salta a ÉL SOLO
   (no bloquea el envío al resto) y al final se informa quién la recibió
   y a quién se le saltó por estar duplicada. */
document.getElementById('btnEnviarJugada').addEventListener('click', async ()=>{
  const btn = document.getElementById('btnEnviarJugada');
  // Evita doble clic / doble envío: mientras la escritura viaja al servidor,
  // el array local JUGADAS todavía no se ha actualizado (onSnapshot llega
  // después), así que sin este bloqueo un segundo clic rápido no detecta
  // la jugada recién enviada como duplicada.
  if(btn.disabled) return;

  // Modo Automática: una jugada separada por CADA lotería marcada del grupo, a cada jugador (ver automatica.js)
  if(NJ_AUTO.activo){ return autoEnviarSeleccionadas(btn); }

  const jugadores = Array.from(NJ_JUGADORES_SELECCIONADOS);
  const loteria = document.getElementById('njLoteria').value;
  const fecha = document.getElementById('njFecha').value;
  const horaSorteo = document.getElementById('njHoraSorteo').value;
  const tipoJugada = document.getElementById('njTipo').value.trim();

  if(jugadores.length === 0){
    toast('Marca al menos un jugador para enviarle la jugada.', 'danger'); return;
  }
  if(!loteria || !fecha || !horaSorteo || !tipoJugada){
    toast('Completa todos los campos de la jugada, incluyendo el tipo y la hora del sorteo.', 'danger'); return;
  }
  if(existeLoteriaYaEnviada({ loteria, fecha, horaSorteo })){
    toast(`Ya se envió una jugada de ${loteria} en el sorteo de ${horaSorteo} del ${fecha} a otro jugador. Esa lotería/sorteo ya no está disponible para enviar a nadie más.`, 'danger');
    return;
  }

  if(NJ_MODO_GENERADO){
    // Modo "Generar numerólogo": cada jugador tiene su propia porción de
    // los 40 números repartidos. Verificamos que sí haya para todos.
    if(!NJ_GENERADO_INFO || NJ_GENERADO_INFO.numeros.length === 0){
      toast('Genera primero los números con "Generar numerólogo".', 'danger'); return;
    }
    if(NJ_GENERADO_INFO.numeros.length < jugadores.length){
      toast(`Solo se generaron ${NJ_GENERADO_INFO.numeros.length} números para repartir entre ${jugadores.length} jugadores; a algunos no les tocaría ninguno. Desmarca jugadores o reduce el grupo.`, 'danger');
      return;
    }
  } else {
    const numerosCompartidos = document.getElementById('njNumeros').value.split(',').map(s=>s.trim()).filter(Boolean);
    if(numerosCompartidos.length === 0){
      toast('Ingresa o carga los números de la jugada.', 'danger'); return;
    }
  }

  // Cada jugador seleccionado debe tener un monto por número válido (>0)
  const sinMonto = jugadores.filter(u => !(NJ_MONTOS_POR_JUGADOR[u]?.monto > 0));
  if(sinMonto.length > 0){
    const nombres = sinMonto.map(u => VENDEDORES.find(v=>v.usuario===u)?.nombre || u).join(', ');
    toast(`Falta un monto por número válido para: ${nombres}.`, 'danger');
    return;
  }

  // ✅ VALIDACIÓN DE MARGEN DE TIEMPO (35 MINUTOS MÍNIMO)
  const fechaHoraSorteo = new Date(`${fecha}T${horaSorteo}:00`);
  const ahora = new Date();
  const diffMinutos = (fechaHoraSorteo - ahora) / 1000 / 60;

  if (diffMinutos < 35) {
    toast('⚠️ La hora del sorteo debe ser al menos 35 minutos después de la hora actual para dar tiempo al jugador. Ajusta la hora o elige otro sorteo.', 'danger');
    return;
  }

  // Filtramos, jugador por jugador, a quién ya se le envió exactamente
  // esta misma jugada (cada uno con SUS propios números: compartidos en
  // modo normal, o su porción repartida en modo generado).
  const aEnviar = [];
  const saltados = [];
  jugadores.forEach(vendedor=>{
    const numerosDelJugador = obtenerNumerosDeJugadorNJ(vendedor);
    if(existeJugadaDuplicada({ vendedor, loteria, fecha, tipoJugada, numeros: numerosDelJugador })){
      saltados.push(vendedor);
    } else {
      aEnviar.push(vendedor);
    }
  });

  if(aEnviar.length === 0){
    toast('Ya le enviaste esta misma jugada (mismo tipo, números y sorteo) a todos los jugadores marcados. Revisa "Jugadas" antes de reenviarla.', 'danger');
    return;
  }

  btn.disabled = true;
  const textoOriginalBtn = btn.textContent;
  btn.textContent = 'Enviando...';

  // Reserva optimista: se agrega de inmediato al array local para que,
  // si el admin logra disparar el envío dos veces antes de que Firestore
  // responda, la segunda llamada a existeJugadaDuplicada() ya la detecte.
  const reservasOptimistas = aEnviar.map(vendedor => ({ vendedor, loteria, fecha, horaSorteo, tipoJugada, numeros: obtenerNumerosDeJugadorNJ(vendedor), estado:'pendiente' }));
  reservasOptimistas.forEach(r => JUGADAS.push(r));

  try{
    const batch = db.batch();
    aEnviar.forEach(vendedor=>{
      const numerosDelJugador = obtenerNumerosDeJugadorNJ(vendedor);
      const montoPorNumero = NJ_MONTOS_POR_JUGADOR[vendedor].monto;
      const montoTotal = numerosDelJugador.length * montoPorNumero;
      const ref = db.collection(COL_JUGADAS).doc();
      batch.set(ref, {
        ticketId: generarTicketId(), vendedor, loteria, tipoJugada, fecha, numeros: numerosDelJugador,
        horaSorteo, limiteJuego: `${fecha}T${horaSorteo}:00`,
        montoPorNumero, montoTotal, estado:'pendiente',
        ...(NJ_AUTO.activo ? { modoAutomatico:true, grupoAutomatico:NJ_AUTO.grupo } : {}),
        estrategiaGeneracion: NJ_ESTRATEGIA_ACTUAL, // qué estrategia generó estos números — usada para la martingala de esa estrategia (ver Configuración)
        enviadoPor: CURRENT_USER.usuario,
        fechaEnvio: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();

    const nombresEnviados = aEnviar.map(u => VENDEDORES.find(v=>v.usuario===u)?.nombre || u).join(', ');
    if(saltados.length === 0){
      toast(`Jugada enviada a ${aEnviar.length} jugador${aEnviar.length===1?'':'es'}: ${nombresEnviados}.`, 'success');
    } else {
      const nombresSaltados = saltados.map(u => VENDEDORES.find(v=>v.usuario===u)?.nombre || u).join(', ');
      toast(`Enviada a: ${nombresEnviados}. Se saltó a ${nombresSaltados} porque ya tenía esta misma jugada.`, 'success');
    }
    closeModal('modalNuevaJugada');
  }catch(err){
    console.error('Error enviando jugada:', err);
    // Si falló el envío, quita las reservas optimistas para no bloquear reintentos válidos.
    reservasOptimistas.forEach(r=>{
      const idx = JUGADAS.indexOf(r);
      if(idx !== -1) JUGADAS.splice(idx, 1);
    });
    toast('No se pudo enviar la jugada: ' + err.message, 'danger');
  }finally{
    btn.disabled = false;
    btn.textContent = textoOriginalBtn;
  }
});

/* Muestra los números de una jugada en el ORDEN ORIGINAL en que están en Firebase.
   opts:
     - ocultarHeader: no muestra la etiqueta "Números jugados · cantidad"
     - compacto: chips más pequeños, pensado para filas de tabla */
function renderNumerosJugados(numeros, opts){
  opts = opts || {};
  
  // 🔥 SIMPLEMENTE COPIAMOS EL ARRAY, SIN ORDENAR NADA
  const lista = (numeros || []).slice();
  
  if(lista.length === 0){
    return `<span class="numeros-vacio">Sin números registrados.</span>`;
  }
  
  const header = opts.ocultarHeader ? '' : `
    <div class="numeros-jugados-header">
      <span class="numeros-jugados-label">Números</span>
      <span class="numeros-jugados-count">${lista.length} ${lista.length===1?'número':'números'}</span>
    </div>`;
  
  return `
    <div class="numeros-jugados-wrap${opts.compacto?' compacto':''}">
      ${header}
      <div class="numeros-jugados">
        ${lista.map(n => `<span class="numchip">${n}</span>`).join('')}
      </div>
    </div>
  `;
}

// FILTRO POR ESTADO - ADMIN JUGADAS (dropdown)
document.getElementById('filtroJugadasAdminSelect').addEventListener('change', function() {
  renderJugadasAdmin();
});

// FILTRO POR FECHA - ADMIN JUGADAS
let filtroFechaJugadasAdmin = '';
document.getElementById('filtroFechaJugadasAdmin').addEventListener('change', function(e) {
  filtroFechaJugadasAdmin = e.target.value;
  renderJugadasAdmin();
});
document.getElementById('btnLimpiarFechaJugadasAdmin').addEventListener('click', function() {
  filtroFechaJugadasAdmin = '';
  document.getElementById('filtroFechaJugadasAdmin').value = '';
  renderJugadasAdmin();
});

function generarJugadaAdminCardHTML(j){
  const vend = VENDEDORES.find(v => v.usuario === j.vendedor);
  return `
    <div class="cobro-card">
      <div class="cobro-head">
        <div class="cobro-head-left">
          <div class="cobro-ic">🎫</div>
          <div>
            <div class="cobro-title">Ticket <span class="mono">${j.ticketId}</span></div>
            <div class="cobro-sub">${vend ? vend.nombre : j.vendedor} · ${fmtFechaHora(j.fechaEnvio)}</div>
          </div>
        </div>
        ${tagEstado(j.estado)}
      </div>
      <div class="cobro-body">
        <div class="cobro-info-grid">
          <div class="cobro-info-item"><div class="lbl">Lotería</div><div class="val">${j.loteria}</div></div>
          <div class="cobro-info-item"><div class="lbl">Tipo</div><div class="val">${j.tipoJugada}</div></div>
          <div class="cobro-info-item"><div class="lbl">Monto</div><div class="val">${fmtMoney(j.montoTotal)}</div></div>
          <div class="cobro-info-item"><div class="lbl">Sorteo</div><div class="val">${j.fecha}${j.horaSorteo ? ' · ' + j.horaSorteo : ''}</div></div>
        </div>
        <div class="cobro-info-item" style="margin-bottom:10px;"><div class="lbl">Números</div><div style="margin-top:6px;">${renderNumerosJugados(j.numeros, { ocultarHeader:true, compacto:true })}</div></div>
        ${(j.estado === 'pendiente' || j.estado === 'aceptada') ? renderCountdownHTML(j) : ''}
        ${j.estado === 'confirmada' && j.ticketFisico ? `<div class="small-muted mono" style="margin-top:8px;">Banca: ${j.banca || '—'} · Ticket físico: ${j.ticketFisico}</div>` : ''}
        ${j.estado === 'rechazada' && j.motivoRechazo ? `<div class="small-muted" style="margin-top:8px;">${j.motivoRechazo}</div>` : ''}
      </div>
    </div>`;
}
function renderJugadasAdmin(){
  const tbody = document.getElementById('tablaJugadasAdmin');
  const cardsWrap = document.getElementById('cardsJugadasAdmin');
  const estadoFiltro = document.getElementById('filtroJugadasAdminSelect').value;
  
  let datos = JUGADAS;
  if(estadoFiltro && estadoFiltro !== '') {
    datos = datos.filter(j => j.estado === estadoFiltro);
  }
  if(filtroFechaJugadasAdmin) datos = datos.filter(j => j.fecha === filtroFechaJugadasAdmin);
  
  if(datos.length === 0){ 
    tbody.innerHTML = `<tr class="empty-row"><td colspan="9">No hay jugadas para este filtro.</td></tr>`; 
    if(cardsWrap) cardsWrap.innerHTML = `<div class="empty-state"><div class="ic"></div>No hay jugadas para este filtro.</div>`;
    return; 
  }
  
  tbody.innerHTML = datos.map(j => {
    const vend = VENDEDORES.find(v => v.usuario === j.vendedor);
    return `<tr>
      <td class="mono">${j.ticketId}</td>
      <td>${vend ? vend.nombre : j.vendedor}</td>
      <td>${j.loteria}</td>
      <td>${j.tipoJugada}</td>
      <td>${renderNumerosJugados(j.numeros, { ocultarHeader:true, compacto:true })}</td>
      <td>${fmtMoney(j.montoTotal)}</td>
      <td>
        <div class="small-muted">${j.fecha}${j.horaSorteo ? ' · ' + j.horaSorteo : ''}</div>
        ${(j.estado === 'pendiente' || j.estado === 'aceptada') ? renderCountdownHTML(j) : ''}
      </td>
      <td>${tagEstado(j.estado)}${j.estado === 'confirmada' && j.ticketFisico ? `<div class="small-muted mono">Banca: ${j.banca || '—'} · Ticket físico: ${j.ticketFisico}</div>` : ''}${j.estado === 'rechazada' && j.motivoRechazo ? `<div class="small-muted">${j.motivoRechazo}</div>` : ''}</td>
      <td class="small-muted">${fmtFechaHora(j.fechaEnvio)}</td>
    </tr>`;
  }).join('');
  if(cardsWrap) cardsWrap.innerHTML = datos.map(generarJugadaAdminCardHTML).join('');
  actualizarCountdowns();
}


document.getElementById('filtroJugadasVendedorSelect').addEventListener('change', function() {
  renderJugadasVendedor();
});

// FILTRO POR FECHA - VENDEDOR JUGADAS
let filtroFechaJugadasVendedor = '';
document.getElementById('filtroFechaJugadasVendedor').addEventListener('change', function(e) {
  filtroFechaJugadasVendedor = e.target.value;
  renderJugadasVendedor();
});
document.getElementById('btnLimpiarFechaJugadasVendedor').addEventListener('click', function() {
  filtroFechaJugadasVendedor = '';
  document.getElementById('filtroFechaJugadasVendedor').value = '';
  renderJugadasVendedor();
});

function renderJugadasVendedor(){
  const wrap = document.getElementById('listaJugadasVendedor');
  const estadoFiltro = document.getElementById('filtroJugadasVendedorSelect').value;
  
  let datos = JUGADAS;
  if(estadoFiltro && estadoFiltro !== '') {
    datos = datos.filter(j => j.estado === estadoFiltro);
  }
  if(filtroFechaJugadasVendedor) datos = datos.filter(j => j.fecha === filtroFechaJugadasVendedor);
  
  if(datos.length === 0){
    wrap.innerHTML = `<div class="empty-state"><div class="ic"></div>No tienes jugadas en este filtro.</div>`;
    return;
  }
  
  wrap.innerHTML = datos.map(j => `
    <div class="card">
      <div class="card-body">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px;">
          <div>
            <div style="font-weight:700; font-size:15px;">${j.loteria} · ${j.tipoJugada}</div>
            <div class="small-muted">Ticket: <span class="mono">${j.ticketId}</span> · Sorteo: ${j.fecha}${j.horaSorteo ? ' ' + j.horaSorteo : ''} · Enviada: ${fmtFechaHora(j.fechaEnvio)}</div>
          </div>
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            ${(j.estado === 'pendiente' || j.estado === 'aceptada') ? renderCountdownHTML(j) : ''}
            ${tagEstado(j.estado)}
          </div>
        </div>
        <div class="divider"></div>
        ${renderNumerosJugados(j.numeros)}
        <div class="small-muted" style="margin-top:10px;">Monto por número: ${fmtMoney(j.montoPorNumero)} · <b>Total: ${fmtMoney(j.montoTotal)}</b></div>
        ${j.estado === 'confirmada' && j.ticketFisico ? `<div class="small-muted mono" style="margin-top:6px;">Banca: ${j.banca || '—'} · Ticket físico: ${j.ticketFisico}</div>` : ''}
        ${j.estado === 'rechazada' && j.motivoRechazo ? `<div class="small-muted" style="margin-top:6px;">Motivo: ${j.motivoRechazo}</div>` : ''}
        ${j.estado === 'pendiente' ? (
          (CURRENT_USER.saldo||0) < (j.montoTotal||0)
            ? `<div class="nj-monto-aviso-saldo" style="margin-top:14px;">⚠️ No puedes aceptar esta jugada: tu saldo es ${fmtMoney(CURRENT_USER.saldo||0)} y esta jugada cuesta ${fmtMoney(j.montoTotal||0)}. Puedes rechazarla o esperar a que te depositen saldo.</div>
              <div class="action-row" style="margin-top:10px;">
                <button class="btn btn-danger btn-sm" onclick="abrirRechazo('jugada','${j.id}')">Rechazar</button>
              </div>`
            : `<div class="action-row" style="margin-top:14px;">
                <button class="btn btn-success btn-sm" onclick="aceptarJugada('${j.id}')">Aceptar</button>
                <button class="btn btn-danger btn-sm" onclick="abrirRechazo('jugada','${j.id}')">Rechazar</button>
              </div>`
        ) : ''}
        ${j.estado === 'aceptada' ? (
          (CURRENT_USER.saldo||0) < (j.montoTotal||0)
            ? `<div class="nj-monto-aviso-saldo" style="margin-top:14px;">⚠️ No puedes confirmar esta jugada todavía: tu saldo es ${fmtMoney(CURRENT_USER.saldo||0)} y esta jugada cuesta ${fmtMoney(j.montoTotal||0)}. Deposita o pide una recarga al admin.</div>`
            : `<div class="action-row" style="margin-top:14px;">
                <button class="btn btn-primary btn-sm" onclick="abrirConfirmarJugada('${j.id}')">Confirmar con ID de ticket</button>
              </div>`
        ) : ''}
      </div>
    </div>
  `).join('');
  actualizarCountdowns();

  // 🔔 Cualquier jugada pendiente que este jugador no pueda aceptar por
  // saldo insuficiente se avisa una sola vez al admin por el chat (el
  // Set en memoria evita reenviar el mismo aviso en cada refresco de la
  // lista mientras siga sin aceptarse).
  datos
    .filter(j => j.estado === 'pendiente' && (CURRENT_USER.saldo||0) < (j.montoTotal||0))
    .forEach(j => notificarNoAceptoPorSaldoAdmin(j));
}

/* Evita reenviar el mismo aviso de "no aceptó por saldo insuficiente"
   una y otra vez mientras la jugada siga pendiente y sin fondos. */
const JUGADAS_ALERTADAS_SALDO_PENDIENTE = new Set();
async function notificarNoAceptoPorSaldoAdmin(jugada){
  if(!jugada || JUGADAS_ALERTADAS_SALDO_PENDIENTE.has(jugada.id)) return;
  JUGADAS_ALERTADAS_SALDO_PENDIENTE.add(jugada.id);
  try{
    await db.collection(COL_CHAT).add({
      autor: CURRENT_USER.usuario,
      autorNombre: CURRENT_USER.nombre || CURRENT_USER.usuario,
      rol: 'sistema',
      texto: `⚠️ ${CURRENT_USER.nombre || CURRENT_USER.usuario} NO pudo aceptar la jugada de ${jugada.loteria} (${jugada.tipoJugada||'—'}) por saldo insuficiente.\nSaldo actual: ${fmtMoney(CURRENT_USER.saldo||0)} — Costo de la jugada: ${fmtMoney(jugada.montoTotal||0)}.\nTicket: ${jugada.ticketId || '—'}. Deposítale saldo si quieres que pueda aceptarla.`,
      audioUrl: null,
      audioDuracionSeg: null,
      fecha: firebase.firestore.FieldValue.serverTimestamp(),
    });
  }catch(err){
    console.error('No se pudo notificar al admin sobre saldo insuficiente al aceptar:', err);
    JUGADAS_ALERTADAS_SALDO_PENDIENTE.delete(jugada.id); // permite reintentar si falló el envío
  }
}

async function aceptarJugada(id){
  const jugada = JUGADAS.find(j=>j.id===id);
  const saldoDisponible = CURRENT_USER.saldo || 0;
  const montoNecesario = jugada ? (jugada.montoTotal || 0) : 0;
  // 🚫 No se puede aceptar una jugada sin saldo suficiente para cubrirla.
  // Es una segunda barrera (la primera es que el botón "Aceptar" ni
  // siquiera se muestra en ese caso) por si el saldo bajó justo entre
  // que se pintó la lista y este clic.
  if(jugada && saldoDisponible < montoNecesario){
    toast(`No puedes aceptar esta jugada: tu saldo (${fmtMoney(saldoDisponible)}) es menor al monto de la jugada (${fmtMoney(montoNecesario)}). Deposita o pide una recarga al admin.`, 'danger');
    notificarNoAceptoPorSaldoAdmin(jugada);
    return;
  }
  await db.collection(COL_JUGADAS).doc(id).update({ estado:'aceptada', fechaAceptacion: firebase.firestore.FieldValue.serverTimestamp() });
  toast('Jugada aceptada', 'success');
}
let rechazoContexto = null;
function abrirRechazo(tipo, id){
  rechazoContexto = { tipo, id };
  document.getElementById('rechazoMotivo').value='';
  openModal('modalRechazar');
}
document.getElementById('btnConfirmarRechazo').addEventListener('click', async ()=>{
  const motivo = document.getElementById('rechazoMotivo').value.trim();
  if(!rechazoContexto) return;
  const col = rechazoContexto.tipo === 'jugada' ? COL_JUGADAS : COL_COBROS;
  await db.collection(col).doc(rechazoContexto.id).update({
    estado:'rechazada', motivoRechazo: motivo || null,
    fechaRechazo: firebase.firestore.FieldValue.serverTimestamp(),
  });
  toast('Rechazada correctamente', 'success');
  closeModal('modalRechazar');
});
/* Techo mínimo de saldo: si al confirmar una jugada el saldo del
   jugador queda por debajo de esto, se avisa automáticamente al admin
   por el chat con un resumen de por qué se agotó. */
const SALDO_MINIMO_ALERTA = 1000;

let jugadaAConfirmar = null;
function abrirConfirmarJugada(id){
  if(!requiereCajaAbierta()) return;
  const jugada = JUGADAS.find(j=>j.id===id);
  const saldoDisponible = CURRENT_USER.saldo || 0;
  const montoNecesario = jugada ? (jugada.montoTotal || 0) : 0;
  if(jugada && saldoDisponible < montoNecesario){
    toast(`No puedes confirmar esta jugada: tu saldo (${fmtMoney(saldoDisponible)}) es menor al monto de la jugada (${fmtMoney(montoNecesario)}). Deposita o pide una recarga al admin.`, 'danger');
    return;
  }
  jugadaAConfirmar = id;
  document.getElementById('cjBanca').value='';
  document.getElementById('cjTicketFisico').value='';
  openModal('modalConfirmarJugada');
}

/* Arma, en texto plano, un resumen de las últimas jugadas confirmadas
   hoy por el jugador — el "por qué" de que su saldo se haya agotado —
   para que el admin lo vea de un vistazo en el chat. */
function construirResumenSaldoBajo({ jugadaActual, saldoAnterior, saldoNuevo }){
  const hoy = hoyStr();
  const confirmadasHoy = JUGADAS
    .filter(j => j.estado === 'confirmada' && j.fecha === hoy)
    .sort((a,b)=> (b.fechaConfirmacion?.seconds||0) - (a.fechaConfirmacion?.seconds||0));
  const totalGastadoHoy = confirmadasHoy.reduce((sum,j)=> sum + (j.montoTotal||0), 0);
  const detalleLineas = confirmadasHoy.slice(0, 5)
    .map(j => `• ${j.loteria} (${j.tipoJugada||'—'}) — ${fmtMoney(j.montoTotal||0)}`)
    .join('\n');

  return (
    `⚠️ ALERTA DE SALDO BAJO\n` +
    `${CURRENT_USER.nombre || CURRENT_USER.usuario} acaba de confirmar ${jugadaActual.loteria} (${jugadaActual.tipoJugada||'—'}) por ${fmtMoney(jugadaActual.montoTotal||0)}.\n` +
    `Saldo anterior: ${fmtMoney(saldoAnterior)} → Saldo actual: ${fmtMoney(saldoNuevo)} (por debajo de ${fmtMoney(SALDO_MINIMO_ALERTA)}).\n\n` +
    `Resumen de sus jugadas confirmadas hoy (${confirmadasHoy.length}, total gastado ${fmtMoney(totalGastadoHoy)}):\n` +
    (detalleLineas || '— sin más jugadas confirmadas hoy —')
  );
}

/* Publica la alerta en el chat grupal (admin + jugadores) como un
   mensaje de rol "sistema", para que se distinga de un mensaje normal
   escrito por el jugador. Si falla el envío, no interrumpe el flujo de
   confirmación (ya se guardó, es solo la notificación). */
async function notificarSaldoBajoAdmin(info){
  try{
    await db.collection(COL_CHAT).add({
      autor: CURRENT_USER.usuario,
      autorNombre: CURRENT_USER.nombre || CURRENT_USER.usuario,
      rol: 'sistema',
      texto: construirResumenSaldoBajo(info),
      audioUrl: null,
      audioDuracionSeg: null,
      fecha: firebase.firestore.FieldValue.serverTimestamp(),
    });
  }catch(err){
    console.error('No se pudo enviar la alerta de saldo bajo al chat:', err);
  }
}

document.getElementById('btnConfirmarJugada').addEventListener('click', async ()=>{
  const banca = document.getElementById('cjBanca').value.trim();
  const ticketFisico = document.getElementById('cjTicketFisico').value.trim();
  if(!banca){ toast('Ingresa el nombre de la banca.', 'danger'); return; }
  if(!ticketFisico){ toast('Ingresa el ID del ticket físico.', 'danger'); return; }
  if(!jugadaAConfirmar) return;
  try{
    const resultadoTx = await db.runTransaction(async (tx)=>{
      const refJugada = db.collection(COL_JUGADAS).doc(jugadaAConfirmar);
      const refUser = db.collection(COL_USUARIOS).doc(CURRENT_USER.usuario);
      const jugadaDoc = await tx.get(refJugada);
      const userDoc = await tx.get(refUser);
      if(jugadaDoc.data().estado !== 'aceptada') throw new Error('Esta jugada ya no está pendiente de confirmación.');
      const saldoActual = userDoc.data().saldo || 0;
      const montoTotal = jugadaDoc.data().montoTotal || 0;
      // 🚫 No se puede jugar (confirmar el ticket) sin saldo suficiente
      // para cubrir esta jugada — se valida aquí también, dentro de la
      // transacción, por si el saldo cambió entre que se abrió el modal
      // y este clic (p. ej. otra jugada confirmada mientras tanto).
      if(saldoActual < montoTotal){
        throw new Error(`No tienes saldo suficiente para confirmar esta jugada. Tu saldo es ${fmtMoney(saldoActual)} y la jugada cuesta ${fmtMoney(montoTotal)}.`);
      }
      const saldoNuevo = saldoActual - montoTotal;
      tx.update(refUser, { saldo: saldoNuevo });
      tx.update(refJugada, {
        estado:'confirmada', banca, ticketFisico,
        fechaConfirmacion: firebase.firestore.FieldValue.serverTimestamp(),
      });
      return {
        saldoAnterior: saldoActual, saldoNuevo, montoTotal,
        loteria: jugadaDoc.data().loteria, tipoJugada: jugadaDoc.data().tipoJugada,
      };
    });
    toast('Jugada confirmada, saldo actualizado', 'success');
    closeModal('modalConfirmarJugada');

    // 🔔 Saldo bajo el mínimo: se avisa al admin por el chat con el
    // resumen de por qué se agotó (sin bloquear ni deshacer nada; la
    // jugada ya quedó confirmada).
    if(resultadoTx.saldoNuevo < SALDO_MINIMO_ALERTA){
      notificarSaldoBajoAdmin({
        jugadaActual: { loteria: resultadoTx.loteria, tipoJugada: resultadoTx.tipoJugada, montoTotal: resultadoTx.montoTotal },
        saldoAnterior: resultadoTx.saldoAnterior,
        saldoNuevo: resultadoTx.saldoNuevo,
      });
    }
  }catch(err){ console.error(err); toast('Error: ' + err.message, 'danger'); }
});

/* ---- Mis cobros ---- */
// FILTRO POR ESTADO - VENDEDOR COBROS (dropdown)
