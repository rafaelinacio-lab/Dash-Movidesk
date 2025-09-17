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

    const DEFAULT_CARD_COLOR = "#2563eb";
    const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;
    let userCardColors = {};

    const toTicketKey = (id) => (id == null ? "" : String(id));

    const normalizeHex = (hex) => {
        if (typeof hex !== "string") return null;
        const value = hex.trim();
        return HEX_COLOR_REGEX.test(value) ? value.toLowerCase() : null;
    };

    const hexToRgb = (hex) => {
        const value = normalizeHex(hex);
        if (!value) return { r: 37, g: 99, b: 235 };
        const clean = value.slice(1);
        const num = parseInt(clean, 16);
        if (Number.isNaN(num)) return { r: 37, g: 99, b: 235 };
        return {
            r: (num >> 16) & 255,
            g: (num >> 8) & 255,
            b: num & 255,
        };
    };

    const makeSoftColor = (hex, alpha = 0.18) => {
        const { r, g, b } = hexToRgb(hex);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    const applyCardColor = (cardEl, hex) => {
        if (!cardEl || !cardEl.style) return;
        const value = normalizeHex(hex);
        if (value) {
            cardEl.classList.add("ticket-custom");
            cardEl.style.setProperty("--ticket-custom-accent", value);
            cardEl.style.setProperty("--ticket-custom-soft", makeSoftColor(value));
        } else {
            cardEl.classList.remove("ticket-custom");
            cardEl.style.removeProperty("--ticket-custom-accent");
            cardEl.style.removeProperty("--ticket-custom-soft");
        }
    };

    const getCardColor = (ticketId) => userCardColors[toTicketKey(ticketId)] || null;

    const showColorError = (message) => {
        if (typeof window !== "undefined" && typeof window.alert === "function") {
            window.alert(message);
        } else {
            console.warn(message);
        }
    };

    const persistCardColor = async (ticketId, color) => {
        const key = toTicketKey(ticketId);
        const payload = { ticketId: key };
        const normalized = normalizeHex(color);
        if (normalized) {
            payload.color = normalized;
        }
        try {
            const resp = await fetch("/api/card-colors", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!resp.ok) {
                const message = await resp.text();
                throw new Error(message || "Falha ao salvar cor personalizada");
            }
            const data = await resp.json();
            if (data && typeof data.color === "string" && normalizeHex(data.color)) {
                userCardColors[key] = normalizeHex(data.color);
            } else {
                delete userCardColors[key];
            }
            return data;
        } catch (err) {
            console.error("Erro ao persistir cor personalizada:", err);
            throw err;
        }
    };

    let userTicketOrder = {};
    let dragState = null;
    const ORDER_COLUMNS = ["novos", "atendimento", "parados", "vencidos"];

    const persistTicketOrder = async (columnKey, order) => {
        try {
            await fetch("/api/ticket-order", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ columnKey, order }),
            });
        } catch (err) {
            console.error("Erro ao salvar ordem de tickets:", err);
        }
    };

    const getOrderIndexMap = (columnKey) => {
        const saved = userTicketOrder[columnKey] || [];
        const map = new Map();
        saved.forEach((ticketId, index) => {
            map.set(String(ticketId), index);
        });
        return map;
    };

    const registerCardDragEvents = (card, columnKey) => {
        card.setAttribute("draggable", "true");
        card.addEventListener("dragstart", (event) => {
            dragState = {
                ticketId: card.dataset.ticketId,
                columnKey,
            };
            card.classList.add("dragging");
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", card.dataset.ticketId);
            }
        });
        card.addEventListener("dragend", () => {
            card.classList.remove("dragging");
            dragState = null;
        });
    };

    const computeDropIndex = (listElement, clientY) => {
        const cards = Array.from(listElement.querySelectorAll(".ticket:not(.dragging)"));
        for (let i = 0; i < cards.length; i += 1) {
            const rect = cards[i].getBoundingClientRect();
            if (clientY < rect.top + rect.height / 2) {
                return i;
            }
        }
        return cards.length;
    };

    const ensureListDnDHandlers = (listElement, columnKey) => {
        if (listElement.dataset.ddInit) return;
        listElement.dataset.ddInit = "true";
        listElement.addEventListener("dragover", (event) => {
            if (!dragState || dragState.columnKey !== columnKey) return;
            event.preventDefault();
            listElement.classList.add("drop-target");
        });
        listElement.addEventListener("dragleave", () => {
            listElement.classList.remove("drop-target");
        });
        listElement.addEventListener("drop", (event) => {
            if (!dragState || dragState.columnKey !== columnKey) return;
            event.preventDefault();
            listElement.classList.remove("drop-target");
            const { ticketId } = dragState;
            const collection = colData[columnKey];
            if (!collection) return;
            const currentIndex = collection.findIndex((item) => String(item.id) === ticketId);
            if (currentIndex === -1) return;
            const dropIndex = computeDropIndex(listElement, event.clientY);
            const [ticket] = collection.splice(currentIndex, 1);
            let targetIndex = dropIndex;
            if (targetIndex > collection.length) targetIndex = collection.length;
            if (targetIndex > currentIndex) targetIndex -= 1;
            collection.splice(targetIndex, 0, ticket);
            userTicketOrder[columnKey] = collection.map((item) => String(item.id));
            persistTicketOrder(columnKey, userTicketOrder[columnKey]);
            dragState = null;
            renderColumns();
        });
    };

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
        card.className = "ticket ticket-can-edit-color";
        if (t.overdue) card.style.outline = "2px solid rgba(220,38,38,.45)";

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

        const currentColor = getCardColor(t.id);
        applyCardColor(card, currentColor);

        const actions = document.createElement("div");
        actions.className = "ticketActions";

        const colorBtn = document.createElement("button");
        colorBtn.type = "button";
        colorBtn.className = "ticketColorBtn";
        colorBtn.title = "Alterar cor do card";
        colorBtn.setAttribute("aria-label", "Alterar cor do card");
        colorBtn.innerHTML = '<svg class="ticketColorIcon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 20h4l9.6-9.6a2.2 2.2 0 0 0-3.1-3.1L5 12.8V20z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6"></path><path d="M12.5 6.5l5 5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6"></path></svg>';
        if (currentColor) {
            colorBtn.style.setProperty("--ticket-btn-color", currentColor);
        }

        const colorInput = document.createElement("input");
        colorInput.type = "color";
        colorInput.className = "ticketColorInput";
        colorInput.value = currentColor || DEFAULT_CARD_COLOR;

        const openColorPicker = () => {
            if (typeof colorInput.showPicker === "function") {
                colorInput.showPicker();
            } else {
                colorInput.click();
            }
        };

        colorInput.addEventListener("input", (event) => {
            const preview = normalizeHex(event.target.value);
            if (!preview) return;
            applyCardColor(card, preview);
            colorBtn.style.setProperty("--ticket-btn-color", preview);
        });

        colorInput.addEventListener("change", async (event) => {
            const chosen = normalizeHex(event.target.value);
            const previous = getCardColor(t.id);
            if (!chosen) {
                event.target.value = previous || DEFAULT_CARD_COLOR;
                return;
            }
            if (chosen === previous) {
                applyCardColor(card, chosen);
                colorBtn.style.setProperty("--ticket-btn-color", chosen);
                return;
            }

            applyCardColor(card, chosen);
            colorBtn.style.setProperty("--ticket-btn-color", chosen);

            try {
                const result = await persistCardColor(t.id, chosen);
                const saved = normalizeHex(result && result.color) || chosen;
                applyCardColor(card, saved);
                colorBtn.style.setProperty("--ticket-btn-color", saved);
                colorInput.value = saved;
            } catch (err) {
                console.error("Erro ao salvar cor personalizada:", err);
                if (previous) {
                    applyCardColor(card, previous);
                    colorBtn.style.setProperty("--ticket-btn-color", previous);
                    colorInput.value = previous;
                } else {
                    applyCardColor(card, null);
                    colorBtn.style.removeProperty("--ticket-btn-color");
                    colorInput.value = DEFAULT_CARD_COLOR;
                }
                showColorError("Não foi possível salvar a cor. Tente novamente.");
            }
        });

        const resetBtn = document.createElement("button");
        resetBtn.type = "button";
        resetBtn.className = "ticketColorReset";
        resetBtn.title = "Remover cor personalizada";

        resetBtn.addEventListener("click", async () => {
            const previous = getCardColor(t.id);
            applyCardColor(card, null);
            colorBtn.style.removeProperty("--ticket-btn-color");
            colorInput.value = DEFAULT_CARD_COLOR;
            try {
                await persistCardColor(t.id, null);
            } catch (err) {
                console.error("Erro ao remover cor personalizada:", err);
                if (previous) {
                    applyCardColor(card, previous);
                    colorBtn.style.setProperty("--ticket-btn-color", previous);
                    colorInput.value = previous;
                }
                showColorError("Não foi possível remover a cor. Tente novamente.");
            }
        });

        colorBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            openColorPicker();
        });

        actions.append(colorBtn, resetBtn, colorInput);
        card.appendChild(actions);

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
            if (!list) return;
            list.innerHTML="";
            list.dataset.columnKey = key;
            ensureListDnDHandlers(list, key);
            const total=colData[key].length;
            const showN=Math.min(visibleCount[key], total);
            const orderIndex = getOrderIndexMap(key);
            const hasSavedOrder = orderIndex.size > 0;
            const ordered = colData[key].slice().sort((a,b)=>{
                const aId = String(a.id);
                const bId = String(b.id);
                const aHasOrder = orderIndex.has(aId);
                const bHasOrder = orderIndex.has(bId);
                if (hasSavedOrder && (aHasOrder || bHasOrder)) {
                    if (aHasOrder && bHasOrder) {
                        return orderIndex.get(aId) - orderIndex.get(bId);
                    }
                    return aHasOrder ? -1 : 1;
                }
                const aFlag = isInativacaoMovidesk(a);
                const bFlag = isInativacaoMovidesk(b);
                if (aFlag !== bFlag) return aFlag ? -1 : 1;
                return 0;
            });
            ordered.slice(0,showN).forEach(t=>{
                const card = buildTicketCard(t);
                card.dataset.ticketId = String(t.id);
                card.dataset.columnKey = key;
                registerCardDragEvents(card, key);
                list.appendChild(card);
            });
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
        try {
            const [ticketsResp, colorsResp, orderResp] = await Promise.all([
                fetch("/api/tickets"),
                fetch("/api/card-colors"),
                fetch("/api/ticket-order"),
            ]);

            if (!ticketsResp.ok) {
                throw new Error(`Falha ao buscar tickets: ${ticketsResp.status}`);
            }

            dados = await ticketsResp.json();

            if (colorsResp.ok) {
                try {
                    const raw = await colorsResp.json();
                    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
                        userCardColors = Object.fromEntries(
                            Object.entries(raw)
                                .map(([ticketId, value]) => {
                                    const normalized = normalizeHex(value);
                                    return normalized ? [toTicketKey(ticketId), normalized] : null;
                                })
                                .filter(Boolean)
                        );
                    } else {
                        userCardColors = {};
                    }
                } catch (err) {
                    userCardColors = {};
                }
            } else if (colorsResp.status === 401) {
                userCardColors = {};
            }

            if (orderResp.ok) {
                try {
                    const payload = await orderResp.json();
                    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
                        userTicketOrder = {};
                        Object.entries(payload).forEach(([columnKey, arr]) => {
                            if (!ORDER_COLUMNS.includes(columnKey)) return;
                            if (!Array.isArray(arr)) return;
                            userTicketOrder[columnKey] = arr.map((id) => String(id));
                        });
                    } else {
                        userTicketOrder = {};
                    }
                } catch (err) {
                    userTicketOrder = {};
                }
            } else if (orderResp.status === 401) {
                userTicketOrder = {};
            }
        } catch (e) {
            console.error("Erro ao buscar /api/tickets:", e);
            const { msg } = ensureDonutHolders(); if (msg) msg.textContent = "Erro ao buscar dados."; renderLegend({});
            const ag = ensureDonutHoldersAgents(); if (ag.msg) ag.msg.textContent = "Erro ao buscar dados."; renderLegendAgents({});
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

        ORDER_COLUMNS.forEach((columnKey) => {
            const present = new Set(colData[columnKey].map((item) => String(item.id)));
            if (!userTicketOrder[columnKey]) return;
            userTicketOrder[columnKey] = userTicketOrder[columnKey].filter((id) => present.has(String(id)));
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
