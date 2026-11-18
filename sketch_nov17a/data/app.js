document.addEventListener("DOMContentLoaded", () => {
    const tbody = document.getElementById('tabla-body');
    const filtroFecha = document.getElementById('filtro-fecha');
    const filtroEstado = document.getElementById('filtro-estado');
    const btnLimpiar = document.getElementById('btn-limpiar');

    const panelConfig = document.getElementById('panel-config');
    const btnToggleConfig = document.getElementById('btn-toggle-config');
    const formConfig = document.getElementById('form-config');
    const btnBorrarDatos = document.getElementById('btn-borrar-datos');
	const btnResetFabrica = document.getElementById('btn-reset-fabrica');
    const configStatus = document.getElementById('config-status');

    let todosLosDatos = [];
    let chartInstancia = null;
    let configActual = { min: 2.0, max: 8.0, intervalo: 5, retardo: 30 };

    function setTexto(id, valor) {
        const el = document.getElementById(id);
        if (el) el.textContent = valor;
    }

    if (btnToggleConfig && panelConfig) {
        btnToggleConfig.addEventListener('click', () => {
            panelConfig.classList.toggle('hidden');
        });
    }

    function formatearEstado(raw) {
        const lower = raw.trim().toLowerCase();
        if (lower === 'error_sensor') return 'ERROR_SENSOR';
        if (lower === 'pre-alerta') return 'Pre-alerta';
        return lower.charAt(0).toUpperCase() + lower.slice(1);
    }

    function obtenerClasesEstado(estado) {
        if (estado === 'Normal') {
            return 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50';
        } else if (estado === 'Pre-alerta') {
            return 'bg-amber-500/20 text-amber-300 border border-amber-500/50';
        } else if (estado === 'Advertencia') {
            return 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50';
        } else if (estado === 'Alerta') {
            return 'bg-red-500/20 text-red-400 border border-red-500/50 animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.5)]';
        } else if (estado === 'ERROR_SENSOR') {
            return 'bg-purple-500/20 text-purple-300 border border-purple-500/50 animate-pulse';
        }
        return 'bg-gray-700 text-gray-300';
    }

    async function cargarConfiguracion() {
        try {
            const res = await fetch(`/config?t=${Date.now()}`);
            if (!res.ok) return;
            configActual = await res.json();

            const inMin = document.getElementById('cfg-min');
            const inMax = document.getElementById('cfg-max');
            const inInt = document.getElementById('cfg-intervalo');
            const inRet = document.getElementById('cfg-retardo');

            if (inMin) inMin.value = configActual.min;
            if (inMax) inMax.value = configActual.max;
            if (inInt) inInt.value = configActual.intervalo;
            if (inRet) inRet.value = configActual.retardo;

            setTexto('kpi-rango-activo', `Umbral activo: ${configActual.min}°C - ${configActual.max}°C`);
            setTexto('kpi-retardo-activo', `Retardo configurado: ${configActual.retardo}s`);
        } catch (e) {
            console.error("Error cargando config:", e);
        }
    }

    if (formConfig) {
        formConfig.addEventListener('submit', async (e) => {
            e.preventDefault();
            const params = new URLSearchParams();
            params.append('min', document.getElementById('cfg-min').value);
            params.append('max', document.getElementById('cfg-max').value);
            params.append('intervalo', document.getElementById('cfg-intervalo').value);
            params.append('retardo', document.getElementById('cfg-retardo').value);

            try {
                const res = await fetch('/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params.toString()
                });
                if (res.ok) {
                    if (configStatus) configStatus.textContent = '✓ Guardado en ESP32';
                    await cargarConfiguracion();
                    setTimeout(() => { if (configStatus) configStatus.textContent = ''; }, 3000);
                } else {
                    if (configStatus) configStatus.textContent = '✗ Valores inválidos';
                }
            } catch (err) {
                if (configStatus) configStatus.textContent = '✗ Error de red';
            }
        });
    }

    if (btnBorrarDatos) {
        btnBorrarDatos.addEventListener('click', async () => {
            try {
                const res = await fetch('/limpiar', { method: 'POST' });
                if (res.ok) {
                    todosLosDatos = [];
                    renderizarTabla([]);
                    if (configStatus) configStatus.textContent = '✓ Historial reiniciado';
                    setTimeout(() => { if (configStatus) configStatus.textContent = ''; }, 3000);
                    cargarDatos();
                }
            } catch (err) {
                console.error("Error limpiando historial:", err);
            }
        });
    }
	
	
    if (btnResetFabrica) {
        btnResetFabrica.addEventListener('click', async () => {
            if (!confirm('¿Estás seguro de restablecer los valores de fábrica? (Se volverá a 2°C - 8°C, muestreo 5s y retardo 30s)')) return;
            try {
                const res = await fetch('/reset-defaults', { method: 'POST' });
                if (res.ok) {
                    if (configStatus) configStatus.textContent = '✓ Restaurado a fábrica';
                    await cargarConfiguracion();
                    setTimeout(() => { if (configStatus) configStatus.textContent = ''; }, 3000);
                } else {
                    if (configStatus) configStatus.textContent = '✗ Error al restablecer';
                }
            } catch (err) {
                console.error("Error restableciendo fábrica:", err);
                if (configStatus) configStatus.textContent = '✗ Error de red';
            }
        });
    }

    function actualizarKPIs(datos) {
        if (datos.length === 0) {
            setTexto('kpi-actual', '-- °C');
            setTexto('kpi-min', '-- °C');
            setTexto('kpi-max', '-- °C');
            setTexto('kpi-preservacion', '-- %');
            setTexto('kpi-total', '0 muestras válidas');
            setTexto('kpi-alertas', '0');
            return;
        }

        const ultimo = datos[datos.length - 1];
        setTexto('kpi-actual', ultimo.esError ? 'ERROR' : `${ultimo.tempNum.toFixed(1)} °C`);
        
        const badgeEstado = document.getElementById('kpi-estado');
        if (badgeEstado) {
            badgeEstado.textContent = ultimo.estado;
            badgeEstado.className = `py-1 px-2.5 rounded-full text-xs font-semibold ${obtenerClasesEstado(ultimo.estado)}`;
        }
        setTexto('kpi-ultima-hora', `Última: ${ultimo.hora}`);

        const validos = datos.filter(d => !d.esError);
        if (validos.length > 0) {
            const temps = validos.map(d => d.tempNum);
            const minTemp = Math.min(...temps);
            const maxTemp = Math.max(...temps);
            const enRango = validos.filter(d => d.tempNum >= configActual.min && d.tempNum <= configActual.max).length;
            const pctPreservacion = (enRango / validos.length) * 100;

            setTexto('kpi-min', `${minTemp.toFixed(1)} °C`);
            setTexto('kpi-max', `${maxTemp.toFixed(1)} °C`);
            setTexto('kpi-preservacion', `${pctPreservacion.toFixed(1)} %`);
            setTexto('kpi-total', `${validos.length} muestras válidas`);
        }

        const totalAlertas = datos.filter(d => d.estado === 'Alerta').length;
        setTexto('kpi-alertas', totalAlertas);
    }

    function actualizarGrafico(datos) {
        const canvas = document.getElementById('grafica-temp');
        if (!canvas || typeof Chart === 'undefined') return;

        const validos = datos.filter(d => !d.esError).slice(-25);
        const etiquetas = validos.map(d => d.hora);
        const valores = validos.map(d => d.tempNum);

        const ctx = canvas.getContext('2d');

        if (!chartInstancia) {
            chartInstancia = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: etiquetas,
                    datasets: [{
                        label: 'Temperatura (°C)',
                        data: valores,
                        borderColor: '#22d3ee',
                        backgroundColor: 'rgba(34, 211, 238, 0.12)',
                        borderWidth: 2.5,
                        pointRadius: 3.5,
                        pointBackgroundColor: '#22d3ee',
                        fill: true,
                        tension: 0.3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: {
                            ticks: { color: '#9ca3af', maxTicksLimit: 8 },
                            grid: { color: 'rgba(55, 65, 81, 0.4)' }
                        },
                        y: {
                            ticks: { color: '#9ca3af' },
                            grid: { color: 'rgba(55, 65, 81, 0.4)' }
                        }
                    }
                }
            });
        } else {
            chartInstancia.data.labels = etiquetas;
            chartInstancia.data.datasets[0].data = valores;
            chartInstancia.update('none');
        }
    }

    async function cargarDatos() {
        try {
            const respuesta = await fetch(`datos.txt?t=${Date.now()}`);
            if (!respuesta.ok) return;
            
            const texto = await respuesta.text();
            const lineas = texto.split('\n');
            todosLosDatos = [];

            lineas.forEach(linea => {
                if (linea.trim() === '') return;
                const partes = linea.split(';');
                if (partes.length >= 3) {
                    const fechaHora = partes[0].trim().split(' ');
                    const fecha = fechaHora[0];
                    const hora = fechaHora[1] || '';
                    const tempNum = parseFloat(partes[1].trim());
                    const estado = formatearEstado(partes[2]);
                    const esError = (estado === 'ERROR_SENSOR' || tempNum <= -100);
                    const temp = esError ? 'Fallo Sonda' : `${tempNum.toFixed(1)} °C`;

                    if (!isNaN(tempNum)) {
                        todosLosDatos.push({ fecha, hora, temp, tempNum, estado, esError });
                    }
                }
            });

            actualizarKPIs(todosLosDatos);
            actualizarGrafico(todosLosDatos);
            aplicarFiltros();
        } catch (error) {
            console.error("Error leyendo datos:", error);
        }
    }

    function renderizarTabla(datos) {
        if (!tbody) return;
        tbody.innerHTML = '';
        if (datos.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="py-8 text-center text-gray-500 font-semibold">Sin registros para mostrar</td></tr>`;
            return;
        }

        const datosOrdenados = [...datos].reverse();
        datosOrdenados.forEach(dato => {
            const tr = document.createElement('tr');
            const estiloEstado = obtenerClasesEstado(dato.estado);
            tr.innerHTML = `
                <td class="py-3.5 px-6 text-center text-gray-300 whitespace-nowrap">${dato.fecha}</td>
                <td class="py-3.5 px-6 text-center text-gray-300 font-mono">${dato.hora}</td>
                <td class="py-3.5 px-6 text-center text-gray-100 font-semibold text-base">${dato.temp}</td>
                <td class="py-3.5 px-6 text-center">
                    <span class="py-1 px-3 rounded-full text-xs font-semibold tracking-wide inline-block ${estiloEstado}">
                        ${dato.estado}
                    </span>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    function aplicarFiltros() {
        let filtrados = todosLosDatos;
        if (filtroEstado && filtroEstado.value !== 'Todos') {
            filtrados = filtrados.filter(d => d.estado === filtroEstado.value);
        }
        if (filtroFecha && filtroFecha.value) {
            const [anio, mes, dia] = filtroFecha.value.split('-');
            const fechaFormateada = `${dia}-${mes}-${anio}`;
            filtrados = filtrados.filter(d => d.fecha === fechaFormateada);
        }
        renderizarTabla(filtrados);
    }

    if (filtroEstado) filtroEstado.addEventListener('change', aplicarFiltros);
    if (filtroFecha) filtroFecha.addEventListener('change', aplicarFiltros);
    if (btnLimpiar) {
        btnLimpiar.addEventListener('click', () => {
            if (filtroEstado) filtroEstado.value = 'Todos';
            if (filtroFecha) filtroFecha.value = '';
            renderizarTabla(todosLosDatos);
        });
    }

    cargarConfiguracion().then(() => {
        cargarDatos();
        setInterval(cargarDatos, 3000);
    });
});