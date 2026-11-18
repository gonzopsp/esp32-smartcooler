document.addEventListener("DOMContentLoaded", () => {
    const tbody = document.getElementById('tabla-body');
    const filtroFecha = document.getElementById('filtro-fecha');
    const filtroEstado = document.getElementById('filtro-estado');
    const btnLimpiar = document.getElementById('btn-limpiar');

    let todosLosDatos = [];
    let chartInstancia = null;

    function obtenerClasesEstado(estado) {
        if (estado === 'Normal') {
            return 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50';
        } else if (estado === 'Advertencia') {
            return 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/50';
        } else if (estado === 'Alerta') {
            return 'bg-red-500/20 text-red-400 border border-red-500/50 animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.5)]';
        }
        return 'bg-gray-700 text-gray-300';
    }

    function actualizarKPIs(datos) {
        if (datos.length === 0) return;

        const ultimo = datos[datos.length - 1];
        const temps = datos.map(d => d.tempNum);
        const minTemp = Math.min(...temps);
        const maxTemp = Math.max(...temps);
        const avgTemp = temps.reduce((a, b) => a + b, 0) / temps.length;
        const totalAlertas = datos.filter(d => d.estado === 'Alerta').length;

        document.getElementById('kpi-actual').textContent = `${ultimo.tempNum.toFixed(1)} °C`;
        const badgeEstado = document.getElementById('kpi-estado');
        badgeEstado.textContent = ultimo.estado;
        badgeEstado.className = `py-1 px-2.5 rounded-full text-xs font-semibold ${obtenerClasesEstado(ultimo.estado)}`;
        document.getElementById('kpi-ultima-hora').textContent = `Última: ${ultimo.hora}`;

        document.getElementById('kpi-min').textContent = `${minTemp.toFixed(1)} °C`;
        document.getElementById('kpi-max').textContent = `${maxTemp.toFixed(1)} °C`;
        document.getElementById('kpi-promedio').textContent = `${avgTemp.toFixed(1)} °C`;
        document.getElementById('kpi-total').textContent = `${datos.length} muestras analizadas`;
        document.getElementById('kpi-alertas').textContent = totalAlertas;
    }

    function actualizarGrafico(datos) {
        if (typeof Chart === 'undefined') return; // Fallback seguro si no hay internet para CDN

        const ultimos20 = datos.slice(-20);
        const etiquetas = ultimos20.map(d => d.hora);
        const valores = ultimos20.map(d => d.tempNum);

        const ctx = document.getElementById('grafica-temp').getContext('2d');

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
                        tension: 0.35
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false }
                    },
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
            chartInstancia.update('none'); // Actualiza sin reiniciar animación
        }
    }

    async function cargarDatos() {
        try {
            // ?t=... evita que el navegador muestre datos viejos cacheados
            const respuesta = await fetch(`datos.txt?t=${Date.now()}`);
            if (!respuesta.ok) throw new Error('No se pudo encontrar datos.txt');
            
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
                    const temp = isNaN(tempNum) ? partes[1].trim() + '°C' : tempNum.toFixed(1) + '°C';
                    
                    let estadoRaw = partes[2].trim().toLowerCase();
                    const estado = estadoRaw.charAt(0).toUpperCase() + estadoRaw.slice(1);
                    
                    if (!isNaN(tempNum)) {
                        todosLosDatos.push({ fecha, hora, temp, tempNum, estado });
                    }
                }
            });

            actualizarKPIs(todosLosDatos);
            actualizarGrafico(todosLosDatos);
            aplicarFiltros(); // Mantiene los filtros activos al refrescar

        } catch (error) {
            console.error("Error:", error);
            if (todosLosDatos.length === 0) {
                tbody.innerHTML = `<tr><td colspan="4" class="py-4 text-center text-red-400 font-semibold">Esperando registros en datos.txt...</td></tr>`;
            }
        }
    }

    function renderizarTabla(datos) {
        tbody.innerHTML = '';
        
        if (datos.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="py-8 text-center text-gray-500 font-semibold">No hay registros que coincidan con los filtros</td></tr>`;
            return;
        }

        // Invertir copia para mostrar el registro más reciente arriba
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
        let datosFiltrados = todosLosDatos;

        const estadoSeleccionado = filtroEstado.value;
        if (estadoSeleccionado !== 'Todos') {
            datosFiltrados = datosFiltrados.filter(dato => dato.estado === estadoSeleccionado);
        }

        const fechaSeleccionada = filtroFecha.value;
        if (fechaSeleccionada) {
            const [anio, mes, dia] = fechaSeleccionada.split('-');
            const fechaFormateada = `${dia}-${mes}-${anio}`;
            datosFiltrados = datosFiltrados.filter(dato => dato.fecha === fechaFormateada);
        }

        renderizarTabla(datosFiltrados);
    }

    filtroEstado.addEventListener('change', aplicarFiltros);
    filtroFecha.addEventListener('change', aplicarFiltros);
    
    btnLimpiar.addEventListener('click', () => {
        filtroEstado.value = 'Todos';
        filtroFecha.value = '';
        renderizarTabla(todosLosDatos);
    });

    // Carga inicial y refresco automático cada 5 segundos
    cargarDatos();
    setInterval(cargarDatos, 5000);
});