(() => {
    /* ---------- Paletas ---------- */
    const urgencyColors = {
        "Crítica":"#ef4444","Alta":"#f97316","Média":"#3b82f6","Baixa":"#6b7280","Não definida":"#9ca3af"
    };
    const agentPalette = [
        "#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#06b6d4",
        "#84cc16","#ec4899","#a855f7","#f97316","#22c55e","#0ea5e9",
        "#eab308","#dc2626","#14b8a6","#64748b","#d946ef","#60a5fa"
    ];

    /* ---------- Helpers ---------- */
    const slug = (s) => (s||"").toString().normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g,"");
    const norm = (s) => (s||"").toString().normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
    const isCanceled = (t) => t.baseStatus==="Canceled" || t.baseStatus==="Cancelled" || String(t.status||"").toLowerCase().includes("cancelad");
    const isInativacaoMovidesk = (ticket) => {
        if (!ticket) return false;
        const parts = [
            ticket.subject,
            ticket.status,
            ticket.statusDetalhado,
            ticket.statusDetailed,
            ticket.category,
            ticket.theme,
            ticket.description
        ];
        if (Array.isArray(ticket.tags)) { parts.push(ticket.tags.join(' ')); }
        const texto = norm(parts.filter(Boolean).join(' '));
        return texto.includes('inativacao') && texto.includes('movidesk');
    };
    /* ---------- POPUP: Inativação Movidesk ---------- */
    let seenAlertIds = new Set();
    const showAlert = (title, message) => {
        const portal = document.getElementById("alertPortal") || document.body;
        const overlay = document.createElement("div");
        overlay.className = "alertOverlay";

        const box = document.createElement("div");
        box.className = "alertBox";
        box.innerHTML = `
      <h4>${title}</h4>
      <p>${message}</p>
      <div class="alertActions">
        <button class="btn" id="btnAlertClose">Fechar</button>
        <button class="btn primary" id="btnAlertOk">OK</button>
      </div>
    `;
        overlay.appendChild(box);
        portal.appendChild(overlay);

        const close = () => overlay.remove();
        overlay.addEventListener("click",(e)=>{ if(e.target===overlay) close(); });
        box.querySelector("#btnAlertClose").addEventListener("click", close);
        box.querySelector("#btnAlertOk").addEventListener("click", close);
    };

    const watchInativacao = (tickets) => {
        tickets.forEach(t => {
            if (isInativacaoMovidesk(t) && !seenAlertIds.has(t.id)) {
                seenAlertIds.add(t.id);
                showAlert("Atenção: Inativação Movidesk",
                    `Ticket #${t.id} identificado com assunto/status de Inativação Movidesk.`);
            }
        });
    };

    /* ---------- PRIORIDADE: holders/legend/donut ---------- */
    const ensureDonutHolders = () => {
        const card = document.getElementById("cardPrioridade");
        let canvas = document.getElementById("graficoDonut");
        let msg = document.getElementById("graficoMsg");
        let legenda = document.getElementById("graficoLegenda");
        if (!canvas){ canvas=document.createElement("canvas"); canvas.id="graficoDonut"; card.querySelector("h3").after(canvas); }
        if (!msg){ msg=document.createElement("div"); msg.id="graficoMsg"; msg.className="graficoMsg"; canvas.after(msg); }
        if (!legenda){ legenda=document.createElement("ul"); legenda.id="graficoLegenda"; legenda.className="legendList"; msg.after(legenda); }
        return {canvas,msg,legenda};
    };

    const renderLegend = (prioridades) => {
        const { legenda } = ensureDonutHolders();
        legenda.innerHTML="";
        const labels = Object.keys(prioridades||{});
        if (!labels.length) return;
        labels.forEach((label)=>{
            const qty = prioridades[label] ?? 0;
            const color = urgencyColors[label] || "#9ca3af";
            const li = document.createElement("li");
            const left = document.createElement("div"); left.className="legendLeft";
            const dot = document.createElement("span"); dot.className="legendDot"; dot.style.background=color;
            const name = document.createElement("span"); name.className="legendName"; name.textContent=label;
            left.appendChild(dot); left.appendChild(name);
            const qtyEl = document.createElement("span"); qtyEl.className="legendQty"; qtyEl.textContent=qty;
            li.appendChild(left); li.appendChild(qtyEl);
            legenda.appendChild(li);
        });
    };

    const renderDonut = (prioridades) => {
        const { canvas, msg } = ensureDonutHolders();
        if (window.graficoDonut){ try{ window.graficoDonut.destroy(); }catch(_){} }
        const labels = Object.keys(prioridades||{});
        const theVals = Object.values(prioridades||{});
        if (!labels.length){ if (msg) msg.textContent="Sem dados para exibir."; renderLegend({}); return; }
        else if (msg) msg.textContent="";
        window.graficoDonut = new Chart(canvas,{
            type:"doughnut",
            data:{ labels, datasets:[{ data:theVals, backgroundColor:labels.map(urg=>urgencyColors[urg]||"#9ca3af") }]},
            options:{ plugins:{ legend:{ display:false } }, cutout:"60%" }
        });
        renderLegend(prioridades);
    };

    /* ---------- AGENTES: holders/legend/donut + dropdown ---------- */
    const ensureDonutHoldersAgents = () => {
        const card = document.getElementById("cardAgentes");
        let canvas = document.getElementById("graficoDonutAgents");
        let msg = document.getElementById("graficoMsgAgents");
        let legenda = document.getElementById("graficoLegendaAgents");
        if (!canvas){ canvas=document.createElement("canvas"); canvas.id="graficoDonutAgents"; card.querySelector("h3").after(canvas); }
        if (!msg){ msg=document.createElement("div"); msg.id="graficoMsgAgents"; msg.className="graficoMsg"; canvas.after(msg); }
        if (!legenda){ legenda=document.createElement("ul"); legenda.id="graficoLegendaAgents"; legenda.className="legendList"; msg.after(legenda); }
        return {canvas,msg,legenda};
    };

    let agentIdsMap = {};
    const renderLegendAgents = (mapa) => {
        const { legenda } = ensureDonutHoldersAgents();
        legenda.innerHTML="";
        const labels = Object.keys(mapa||{});
        if (!labels.length) return;
        labels.forEach((name,i)=>{
            const qty = mapa[name] ?? 0;
            const color = agentPalette[i % agentPalette.length];
            const li = document.createElement("li");
            const left = document.createElement("div"); left.className="legendLeft";
            const dot = document.createElement("span"); dot.className="legendDot"; dot.style.background=color;
            const nm  = document.createElement("span"); nm.className="legendName"; nm.textContent=name;
            left.appendChild(dot); left.appendChild(nm);
            const qtyEl = document.createElement("span"); qtyEl.className="legendQty"; qtyEl.textContent=qty;

            const drop = document.createElement("div");
            drop.className="legendTickets";
            drop.setAttribute("aria-hidden","true");
            const ids = (agentIdsMap[name]||[]).slice().sort((a,b)=>Number(a)-Number(b));
            ids.forEach(id=>{
                const badge=document.createElement("span");
                badge.className="legendTicketBadge";
                badge.textContent=`#${id}`;
                drop.appendChild(badge);
            });

            li.addEventListener("click",()=>{
                legenda.querySelectorAll(".legendTickets.show").forEach(el=>{
                    if (el!==drop){ el.classList.remove("show"); el.setAttribute("aria-hidden","true"); }
                });
                const willShow=!drop.classList.contains("show");
                drop.classList.toggle("show",willShow);
                drop.setAttribute("aria-hidden",String(!willShow));
            });

            li.appendChild(left); li.appendChild(qtyEl);
            legenda.appendChild(li);
            const container=document.createElement("div"); container.style.width="100%"; container.appendChild(drop);
            legenda.appendChild(container);
        });
    };

    const renderDonutAgents = (mapa) => {
        const { canvas, msg } = ensureDonutHoldersAgents();
        if (window.graficoDonutAgents){ try{ window.graficoDonutAgents.destroy(); }catch(_){} }
        const labels=Object.keys(mapa||{}), valores=Object.values(mapa||{});
        if (!labels.length){ if (msg) msg.textContent="Sem dados para exibir."; renderLegendAgents({}); return; }
        else if (msg) msg.textContent="";
        const colors = labels.map((_,i)=>agentPalette[i%agentPalette.length]);
        window.graficoDonutAgents = new Chart(canvas,{
            type:"doughnut",
            data:{ labels, datasets:[{ data:valores, backgroundColor:colors }]},
            options:{ plugins:{ legend:{ display:false } }, cutout:"60%" }
        });
        renderLegendAgents(mapa);
    };

    /* ---------- INÍCIO: CÓDIGO ADICIONADO E MELHORADO ---------- */
    /**
     * Popula um dropdown com a lista de agentes para o filtro do Kanban.
     * Esta versão é mais robusta para manipular as opções do <select>.
     * @param {string[]} agents - Array com os nomes dos agentes.
     */
    const renderAgentFilterDropdown = (agents) => {
        const dropdown = document.getElementById("agentFilter");
        if (!dropdown) {
            console.warn("Dropdown de filtro de agente '#agentFilter' não encontrado.");
            return;
        }

        const selectedValue = dropdown.value;

        // Limpa as opções existentes de forma segura
        while (dropdown.options.length > 0) {
            dropdown.remove(0);
        }

        // Adiciona a opção "Todos os Agentes"
        dropdown.add(new Option("Todos os Agentes", "all"));

        // Adiciona os agentes da lista
        agents.sort().forEach(agentName => {
            dropdown.add(new Option(agentName, agentName));
        });

        // Tenta restaurar a seleção anterior, se o valor ainda for válido
        if (Array.from(dropdown.options).some(opt => opt.value === selectedValue)) {
            dropdown.value = selectedValue;
        } else {
            dropdown.value = "all";
        }
    };
    /* ---------- FIM: CÓDIGO ADICIONADO E MELHORADO ---------- */


    /* ---------- Paginação por coluna ---------- */
    const PAGE = 5;
    const colData = {novos:[],atendimento:[],parados:[],vencidos:[]};
    const visibleCount = {novos:PAGE,atendimento:PAGE,parados:PAGE,vencidos:PAGE};

    const buildTicketCard = (t) => {
        const statusSlug = slug(t.status || "nao definido");
        const urgSlug  = slug(t.urgency || "Não definida");

        // Previsão de solução (usa dueCategory do backend)
        let prevSolTxt = "-", prevClass = "gray";
        if (t.previsaoSolucao){
            const due = new Date(t.previsaoSolucao+"T23:59:59");
            prevSolTxt = due.toLocaleDateString();
            if (t.dueCategory === "overdue" || t.overdue) prevClass = "red";
            else if (t.dueCategory === "warning")         prevClass = "orange";
            else if (t.dueCategory === "ok")              prevClass = "green";
            else                                          prevClass = "gray";
        }

        const card = document.createElement("div");
        card.className = "ticket";
        if (t.overdue) card.style.outline = "2px solid rgba(220,38,38,.45)";

        // Flag especial: Inativação Movidesk
        if (isInativacaoMovidesk(t)) {
            card.classList.add("ticket-flagged");
        }

        card.innerHTML = `
      <h4>#${t.id} - ${t.subject}</h4>
      <p><b>Urgência:</b> <span class="pill urg-${urgSlug}">${t.urgency || "Não definida"}</span></p>
      <p><b>Status detalhado:</b>
        <span class="statusDetalhado status-${statusSlug}">${t.status || "Não definido"}</span>
      </p>
      <p><b>Prev. solução:</b> <span class="badgePrev ${prevClass}">${prevSolTxt}</span></p>
      <div class="responsavelBox">
        <span class="badge responsavel">${t.owner}</span>
      </div>
      <small>Criado em ${t.createdDate ? new Date(t.createdDate).toLocaleDateString() : "-"}</small>
    `;
        return card;
    };

    const renderColumns = () => {
        document.getElementById("countNovos").textContent       = colData.novos.length;
        document.getElementById("countAtendimento").textContent = colData.atendimento.length;
        document.getElementById("countParados").textContent     = colData.parados.length;
        document.getElementById("countVencidos").textContent    = colData.vencidos.length;

        const defs = [
            {key:"novos",listId:"novosLista",btnSel:'button[data-col="novos"]'},
            {key:"atendimento",listId:"atendimentoLista",btnSel:'button[data-col="atendimento"]'},
            {key:"parados",listId:"paradosLista",btnSel:'button[data-col="parados"]'},
            {key:"vencidos",listId:"vencidosLista",btnSel:'button[data-col="vencidos"]'},
        ];

        defs.forEach(({key,listId,btnSel})=>{
            const list=document.getElementById(listId);
            const btn=document.querySelector(btnSel);
            list.innerHTML="";
            const total=colData[key].length;
            const showN=Math.min(visibleCount[key], total);
            const ordered = colData[key].slice().sort((a,b)=>{
                const aFlag = isInativacaoMovidesk(a);
                const bFlag = isInativacaoMovidesk(b);
                if (aFlag === bFlag) return 0;
                return aFlag ? -1 : 1;
            });
            ordered.slice(0,showN).forEach(t=>list.appendChild(buildTicketCard(t)));
            if (btn) btn.style.display = total > showN ? "block" : "none";
        });
    };

    const attachMoreHandlers = () => {
        document.querySelectorAll(".btnMore").forEach(btn=>{
            btn.addEventListener("click",()=>{
                const col=btn.getAttribute("data-col");
                visibleCount[col]+=PAGE;
                renderColumns();
            });
        });
    };

    /* ---------- Carga principal ---------- */
    const carregarDashboard = async () => {
        let dados;
        try{
            const resp = await fetch("/api/tickets");
            dados = await resp.json();
        }catch(e){
            console.error("Erro ao buscar /api/tickets:", e);
            const { msg } = ensureDonutHolders(); if (msg) msg.textContent="Erro ao buscar dados."; renderLegend({});
            const ag = ensureDonutHoldersAgents(); if (ag.msg) ag.msg.textContent="Erro ao buscar dados."; renderLegendAgents({});
            return;
        }

        /* Widgets */
        // ✅ Agora usa a métrica correta do backend: criados do 1º dia do mês até hoje
        document.getElementById("totalTickets").innerText = dados.counts?.CreatedThisMonth ?? 0;

        document.getElementById("novos").innerText        = dados.counts?.New ?? 0;
        document.getElementById("emAtendimento").innerText= dados.counts?.InAttendance ?? 0;
        document.getElementById("parados").innerText      = dados.counts?.Stopped ?? 0;

        // Em aberto (operacional)
        const abertos = dados.counts?.OpenTickets ??
            ((dados.counts?.New ?? 0) + (dados.counts?.InAttendance ?? 0) + (dados.counts?.Stopped ?? 0));
        document.getElementById("abertos").innerText = abertos;

        const criticos = (dados.tickets||[]).filter(
            t => t.urgency==="Crítica" && ["New","InAttendance","Stopped"].includes(t.baseStatus) && !isCanceled(t)
        ).length;
        document.getElementById("criticos").innerText = criticos;

        // Reset colunas/paginadores
        colData.novos = []; colData.atendimento = []; colData.parados = []; colData.vencidos = [];
        visibleCount.novos = visibleCount.atendimento = visibleCount.parados = visibleCount.vencidos = PAGE;

        // Distribui tickets (ignora fechados/resolvidos/cancelados)
        (dados.tickets||[]).forEach(t=>{
            const closed = (t.baseStatus==="Closed" || t.baseStatus==="Resolved");
            if (closed || isCanceled(t)) return;
            if (t.overdue) colData.vencidos.push(t);
            else if (t.baseStatus==="New") colData.novos.push(t);
            else if (t.baseStatus==="InAttendance") colData.atendimento.push(t);
            else if (t.baseStatus==="Stopped") colData.parados.push(t);
        });

        renderColumns();

        // Donut prioridade (fallback se precisar)
        let prioridades = dados.countsPerUrgency;
        if (!prioridades || !Object.keys(prioridades).length){
            const ativos = (dados.tickets||[]).filter(t => !["Closed","Resolved"].includes(t.baseStatus) && !isCanceled(t));
            const calc={}; ativos.forEach(t=>{ const u=t.urgency||"Não definida"; calc[u]=(calc[u]||0)+1; });
            prioridades = calc;
        }
        renderDonut(prioridades);

        // Mapa de IDs por agente (ativos e não cancelados)
        agentIdsMap = {};
        (dados.tickets||[])
            .filter(t => !["Closed","Resolved"].includes(t.baseStatus) && !isCanceled(t))
            .forEach(t => { const name=t.owner||"Não atribuído"; (agentIdsMap[name] ||= []).push(t.id); });

        // Donut agentes
        let porAgente = dados.countsPerOwner;
        if (!porAgente || !Object.keys(porAgente).length){
            porAgente = {}; Object.keys(agentIdsMap).forEach(n => porAgente[n] = agentIdsMap[n].length);
        }
        renderDonutAgents(porAgente);

        // ---------- INÍCIO: CÓDIGO ADICIONADO E MELHORADO ----------
        // Popula o dropdown com a lista de agentes do gráfico
        renderAgentFilterDropdown(Object.keys(porAgente));
        // ---------- FIM: CÓDIGO ADICIONADO E MELHORADO ----------

        // 🔔 Verificação de “Inativação Movidesk”
        watchInativacao(dados.tickets || []);
    };

    // Tema claro/escuro
    document.getElementById("toggleTheme").addEventListener("click",()=>{
        document.body.classList.toggle("dark");
        document.getElementById("toggleTheme").textContent =
            document.body.classList.contains("dark") ? "☀️ Tema Claro" : "🌙 Tema Escuro";
    });

    attachMoreHandlers();
    carregarDashboard();
    setInterval(carregarDashboard, 300000); // 5 min
})();
