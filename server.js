import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import session from "express-session";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";
import path from "path";
import { fileURLToPath } from "url";
import dns from "node:dns";
import fs from "fs/promises";
import { BusinessDays } from "business-days-js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

/* -------------------- DB -------------------- */
const db = await mysql.createPool({
    host: process.env.DB_HOST || "192.168.91.168",
    port: process.env.DB_PORT || 5432,   // 🔹 seu MariaDB está rodando nesta porta
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASS || "V!@soft2025#@2306",
    database: process.env.DB_NAME || "si_panel",
});

/* ---------------- Sessão ------------------- */
app.use(session({
    secret: process.env.SESSION_SECRET || "segredo123",
    resave: false,
    saveUninitialized: false,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ------------------ Paths ------------------ */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MELHORIAS_PATH = path.join(__dirname, "melhorias.json");

/* ----------------- Login ------------------- */
app.get("/", (req, res) => {
    if (!req.session.userId) {
        return res.sendFile(path.join(__dirname, "public/login.html"));
    }
    res.redirect("/dashboard");
});

app.post("/login", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password)
        return res.status(400).json({ error: "Usuário e senha obrigatórios" });

    try {
        const [rows] = await db.query("SELECT * FROM users WHERE username = ?", [username]);
        if (rows.length === 0) return res.status(401).json({ error: "Usuário não encontrado" });

        const user = rows[0];
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.status(401).json({ error: "Senha incorreta" });

        req.session.userId = user.id;
        req.session.team = user.team;
        req.session.role = user.role;

        res.json({ success: true, message: "Login realizado com sucesso" });
    } catch (err) {
        console.error("❌ Erro login:", err);
        res.status(500).json({ error: "Erro interno" });
    }
});

app.get("/dashboard", (req, res) => {
    if (!req.session.userId) return res.redirect("/");
    res.sendFile(path.join(__dirname, "public/index.html"));
});

app.get("/logout", (req, res) => {
    req.session.destroy(() => res.redirect("/"));
});

/* ---------------- Middleware ---------------- */
function requireAdmin(req, res, next) {
    if (!req.session.userId || req.session.role !== "admin") {
        return res.status(403).send("Acesso negado");
    }
    next();
}

/* ---------------- Rotas de Usuário ---------------- */
app.get("/api/me", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Não autenticado" });

    try {
        const [rows] = await db.query("SELECT id, username, team, role FROM users WHERE id = ?", [req.session.userId]);
        if (!rows.length) return res.status(404).json({ error: "Usuário não encontrado" });
        res.json(rows[0]);
    } catch (err) {
        console.error("❌ Erro ao buscar usuário:", err.message);
        res.status(500).json({ error: "Erro interno" });
    }
});

/* ---------------- Rotas Admin ---------------- */
// ... (Suas rotas de admin)

/* ---------------- Movidesk & Funções Auxiliares ----------------- */
const MOVI_TOKEN = (process.env.MOVI_TOKEN || "").trim();
const MOVI_URL = (process.env.MOVI_URL || "https://api.movidesk.com/public/v1/tickets").trim();

try { dns.setDefaultResultOrder("ipv4first"); } catch {}

const isClosedOrResolved = (t) => t.baseStatus === "Closed" || t.baseStatus === "Resolved";
const isCanceled = (t) => {
    if (t.baseStatus === "Canceled" || t.baseStatus === "Cancelled") return true;
    return String(t.status || "").toLowerCase().includes("cancelad");
};

/* ---------------- API Tickets (Dashboard) ----------------- */
// ... (Sua rota /api/tickets)

/* ---------------- Relatórios ---------------- */
app.get("/api/report-teams", requireAdmin, async (req, res) => {
    try {
        const [rows] = await db.query("SELECT DISTINCT team FROM users WHERE team IS NOT NULL AND team <> '' ORDER BY team");
        res.json(rows.map(r => r.team));
    } catch (err) {
        console.error("Erro ao listar equipes:", err.message);
        res.status(500).json({ error: "Erro ao listar equipes" });
    }
});

app.get("/api/reports", async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: "Não autenticado" });
        
        const { team: userTeam, role: userRole } = req.session;
        if (!userTeam) return res.status(400).json({ error: "Equipe não definida para o usuário" });

        const { teams: teamsParam, start: startDate, end: endDate } = req.query;
        let teamsToQuery = [];

        if (userRole === "admin" && teamsParam) {
            teamsToQuery = teamsParam.toString().trim().split(",").map(s => s.trim()).filter(Boolean);
        } else {
            teamsToQuery = [userTeam];
        }
        if (teamsToQuery.length === 0) teamsToQuery = [userTeam];

        const fetchTeamTickets = async (team) => {
            try {
                // --- INÍCIO DA LÓGICA DE FILTRO DE DATA ---
                let dateFilter = "";
                if (startDate && endDate) {
                    // Formata as datas para o padrão ISO 8601 que a API do Movidesk espera
                    const startISO = new Date(startDate).toISOString();
                    const end = new Date(endDate);
                    // Adiciona 1 dia à data final para incluir todos os tickets do último dia
                    end.setDate(end.getDate() + 1);
                    const endISO = end.toISOString();

                    // Lógica do filtro:
                    // - Tickets criados ANTES do fim do período E
                    // - (Que foram fechados DEPOIS do início do período OU que ainda estão abertos)
                    dateFilter = ` and createdDate lt ${endISO} and (closedIn ge ${startISO} or closedIn eq null)`;
                }
                // --- FIM DA LÓGICA DE FILTRO DE DATA ---

                const baseFilter = `ownerTeam eq '${team}'`;
                const fullFilter = baseFilter + dateFilter;
                
                const url = `${MOVI_URL}?token=${MOVI_TOKEN}&$top=1000&$select=id,baseStatus,status,ownerTeam,owner&$expand=owner($select=businessName)&$filter=${encodeURIComponent(fullFilter)}`;
                
                console.log(`[LOG] Consultando Movidesk para a equipe "${team}" com filtro: ${fullFilter}`);
                
                const { data } = await axios.get(url, { timeout: 20000 });
                console.log(`[LOG] Recebidos ${data.length} tickets para "${team}" no período selecionado.`);

                return data.map(t => ({
                    id: t.id,
                    baseStatus: t.baseStatus,
                    status: t.status || "",
                    ownerTeam: t.ownerTeam || team,
                    owner: t.owner?.businessName || "Não atribuído",
                }));
            } catch (err) {
                console.error(`[LOG] Erro ao buscar tickets para a equipe '${team}':`, err.message);
                return [];
            }
        };

        const results = [];
        for (const team of teamsToQuery) {
            const [teamUsers] = await db.query("SELECT username FROM users WHERE team = ?", [team]);
            const teamMembers = new Set(teamUsers.map(u => u.username));
            
            const tickets = await fetchTeamTickets(team);
            const agg = { open: 0, closed: 0, resolved: 0, canceled: 0, total: 0 };
            
            const perAgent = {};
            teamMembers.forEach(memberName => {
                perAgent[memberName] = { open: 0, closed: 0, resolved: 0, canceled: 0, total: 0 };
            });
            perAgent["Não atribuído"] = { open: 0, closed: 0, resolved: 0, canceled: 0, total: 0 };

            tickets.forEach(t => {
                const agent = t.owner;
                let key;
                if (isCanceled(t)) key = "canceled";
                else if (isClosedOrResolved(t)) key = "resolved";
                else key = "open";

                agg[key]++;
                agg.total++;

                if (teamMembers.has(agent) || agent === "Não atribuído") {
                    if (perAgent[agent]) {
                        perAgent[agent][key]++;
                        perAgent[agent].total++;
                    }
                }
            });
            results.push({ team, totals: agg, perAgent });
        }
        res.json({ teams: results });
    } catch (err) {
        console.error("Erro em /api/reports:", err.message);
        res.status(500).json({ error: "Erro ao gerar relatório" });
    }
});



/* ---------------- Lógica de Cálculo de SLA ---------------- */
const businessDays = new BusinessDays();
businessDays.setWorkingHours({
    0: null, // Domingo
    1: [{ start: "07:45", end: "12:00" }, { start: "13:30", end: "18:00" }], // Segunda
    2: [{ start: "07:45", end: "12:00" }, { start: "13:30", end: "18:00" }], // Terça
    3: [{ start: "07:45", end: "12:00" }, { start: "13:30", end: "18:00" }], // Quarta
    4: [{ start: "07:45", end: "12:00" }, { start: "13:30", end: "18:00" }], // Quinta
    5: [{ start: "07:45", end: "12:00" }, { start: "13:30", end: "18:00" }], // Sexta
    6: null, // Sábado
});

const calcularSlaEmMinutosUteis = (dataInicio, dataFim) => {
    if (!dataInicio) return 0;
    const inicio = new Date(dataInicio);
    const fim = dataFim ? new Date(dataFim) : new Date();
    return businessDays.getWorkingMinutes(inicio, fim);
};

/* ---------------- Rota de SLA -------------------- */
app.get("/api/sla/:ticketId", requireAdmin, async (req, res) => {
    const { ticketId } = req.params;

    if (!MOVI_TOKEN) {
        return res.status(500).json({ error: "MOVI_TOKEN não configurado" });
    }

    try {
        const url = `${MOVI_URL}?token=${MOVI_TOKEN}&id=${ticketId}&$expand=actions,owner`;
        const { data } = await axios.get(url);

        if (!data || data.length === 0) {
            return res.status(404).json({ error: "Ticket não encontrado" });
        }

        const ticket = data[0];
        const slaPorEquipe = {};
        let equipeAtual = ticket.ownerTeam;
        let dataInicioEtapa = ticket.createdDate;

        const actions = [
            { type: "Criação", createdDate: ticket.createdDate, description: `Ticket criado na equipe ${equipeAtual}` },
            ...ticket.actions
        ];

        actions.forEach((action) => {
            if (action.type === 3 && action.origin === 2 && action.description.includes("Equipe do ticket alterada de")) {
                const partes = action.description.split("'");
                if (partes.length >= 4) {
                    const novaEquipe = partes[3];
                    if (novaEquipe !== equipeAtual) {
                        const tempoGasto = calcularSlaEmMinutosUteis(dataInicioEtapa, action.createdDate);
                        slaPorEquipe[equipeAtual] = (slaPorEquipe[equipeAtual] || 0) + tempoGasto;
                        equipeAtual = novaEquipe;
                        dataInicioEtapa = action.createdDate;
                    }
                }
            }
        });

        const dataFinalTicket = ticket.closedIn || ticket.resolvedIn || null;
        const tempoGastoFinal = calcularSlaEmMinutosUteis(dataInicioEtapa, dataFinalTicket);
        slaPorEquipe[equipeAtual] = (slaPorEquipe[equipeAtual] || 0) + tempoGastoFinal;

        const slaTotal = Object.values(slaPorEquipe).reduce((acc, val) => acc + val, 0);
        const resultadoEquipes = Object.entries(slaPorEquipe).map(([equipe, tempo]) => ({
            equipe,
            tempo
        }));

        res.json({
            ticketId: ticket.id,
            assunto: ticket.subject,
            status: ticket.status,
            criadoEm: ticket.createdDate,
            fechadoEm: dataFinalTicket,
            slaPorEquipe: resultadoEquipes,
            slaTotal,
        });

    } catch (err) {
        console.error(`❌ Erro ao buscar SLA do ticket #${ticketId}:`, err.message);
        res.status(500).json({ error: "Erro interno ao buscar dados do ticket para SLA" });
    }
});

/* static files */
app.use(express.static("public"));

/* start */
app.listen(PORT, () => console.log(`✅ Servidor rodando em http://localhost:${PORT}`));