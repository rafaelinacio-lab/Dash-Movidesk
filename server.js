
import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import session from "express-session";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";
import path from "path";
import { fileURLToPath } from "url";
import dns from "node:dns";

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

        // 🔹 Salva dados na sessão
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
app.get("/admin/users", requireAdmin, async (req, res) => {
    const [rows] = await db.query("SELECT id, username, team, role FROM users");
    res.json(rows);
});


app.post("/admin/users/update", requireAdmin, async (req, res) => {
    const { userId, team, role } = req.body;
    try {
        await db.query("UPDATE users SET team = ?, role = ? WHERE id = ?", [team, role, userId]);
        res.json({ success: true });
    } catch (err) {
        console.error("❌ Erro ao atualizar usuário:", err);
        res.status(500).json({ error: "Erro ao atualizar usuário" });
    }
});

// Rota para excluir usuário
app.post("/admin/users/delete", requireAdmin, async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "ID do usuário obrigatório" });
    try {
        await db.query("DELETE FROM users WHERE id = ?", [userId]);
        res.json({ success: true });
    } catch (err) {
        console.error("❌ Erro ao excluir usuário:", err);
        res.status(500).json({ error: "Erro ao excluir usuário" });
    }
});
// Rota para criar usuário
app.post("/admin/users/create", requireAdmin, async (req, res) => {
    const { username, password, team, role } = req.body;
    if (!username || !password || !team || !role) {
        return res.status(400).json({ error: "Dados obrigatórios ausentes" });
    }
    try {
        // Verifica se já existe usuário com o mesmo nome
        const [rows] = await db.query("SELECT id FROM users WHERE username = ?", [username]);
        if (rows.length > 0) {
            return res.status(409).json({ error: "Usuário já existe" });
        }
        // Hash da senha
        const password_hash = await bcrypt.hash(password, 10);
        await db.query(
            "INSERT INTO users (username, password_hash, team, role) VALUES (?, ?, ?, ?)",
            [username, password_hash, team, role]
        );
        res.json({ success: true });
    } catch (err) {
        console.error("❌ Erro ao criar usuário:", err);
        res.status(500).json({ error: "Erro ao criar usuário" });
    }
});

/* ---------------- Movidesk ----------------- */
const MOVI_TOKEN = (process.env.MOVI_TOKEN || "").trim();
const MOVI_URL = (process.env.MOVI_URL || "https://api.movidesk.com/public/v1/tickets").trim();

try { dns.setDefaultResultOrder("ipv4first"); } catch {}

const ymd = (dateObj) => {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, "0");
    const d = String(dateObj.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
};
const parseAnyDate = (str) => {
    if (!str) return null;
    const d1 = new Date(str);
    if (!isNaN(d1)) return d1;
    const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(str));
    if (m) {
        const [, dd, mm, yyyy] = m;
        return new Date(Number(yyyy), Number(mm) - 1, Number(dd), 12, 0, 0);
    }
    return null;
};
const normalizeStr = (s = "") =>
    s.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const getForecastRaw = (t) => {
    const labels = [
        "previsão de solução","previsao de solucao","previsão solução","previsao solucao",
        "previsao","solution forecast","forecast","sla solução","sla solucao",
    ];
    const arr = [
        ...(Array.isArray(t.customFieldValues) ? t.customFieldValues : []),
        ...(Array.isArray(t.customFields) ? t.customFields : []),
    ].map((cf) => ({
        label: cf.label || cf.title || cf.name || cf.customField?.label || cf.customField?.title,
        value: cf.value || cf.valueText || cf.text || cf.customFieldValue,
    }));
    const found = arr.find((cf) => cf.label && labels.some((L) => normalizeStr(cf.label).includes(normalizeStr(L))));
    return found?.value || null;
};

const isClosedOrResolved = (t) => t.baseStatus === "Closed" || t.baseStatus === "Resolved";
const isCanceled = (t) => {
    if (t.baseStatus === "Canceled" || t.baseStatus === "Cancelled") return true;
    const s = String(t.status || "").toLowerCase();
    return s.includes("cancelad");
};
const isInactive = (t) => isClosedOrResolved(t) || isCanceled(t);

const diffDays = (dateA, dateB) => Math.floor((dateA.getTime() - dateB.getTime()) / 86400000);
const getDueInfo = (prevISO, inactive, todayLocalISO) => {
    if (!prevISO) return { overdue: false, daysUntilDue: null, dueCategory: "none" };
    const [Yd, Md, Dd] = prevISO.split("-").map(Number);
    const [Yt, Mt, Dt] = todayLocalISO.split("-").map(Number);
    const due = new Date(Yd, Md - 1, Dd);
    const today = new Date(Yt, Mt - 1, Dt);
    const days = diffDays(due, today);
    const overdue = days < 0 && !inactive;
    let dueCategory = "ok";
    if (!inactive) {
        if (overdue) dueCategory = "overdue";
        else if (days <= 2) dueCategory = "warning";
    }
    return { overdue, daysUntilDue: days, dueCategory };
};

/* ============ Mock e Cache ============ */
const makeMockPayload = () => {
    const today = new Date();
    const ymdToday = ymd(today);
    const mk = (id, subj, baseStatus, status, urgency, owner="Não atribuído") => ({
        id, subject: subj, urgency, baseStatus, status, owner,
        ownerTeam: "Sustentação", createdDate: today.toISOString(),
        previsaoSolucao: ymdToday, overdue: false, daysUntilDue: 2, dueCategory: "ok",
        canceled: false, isNew: baseStatus==="New"
    });
    const tickets = [
        mk(1001,"Inativação Movidesk - Cliente X","New","Novo","Crítica","Agente A"),
        mk(1002,"Contexto - Ajuste de SLA","New","Novo","Alta","Agente B"),
        mk(1003,"Erro na emissão","InAttendance","Em Atendimento","Média","Agente B"),
        mk(1004,"Aguardando - Fornecedor","Stopped","Aguardando","Alta","Agente C"),
    ];
    const counts = {
        Total: tickets.length,
        New: tickets.filter(t=>t.baseStatus==="New").length,
        InAttendance: tickets.filter(t=>t.baseStatus==="InAttendance").length,
        Stopped: tickets.filter(t=>t.baseStatus==="Stopped").length,
        Closed: 0,
        Overdue: 0,
        MonthOpenedAll: tickets.length,
    };
    counts.OpenTickets = counts.New + counts.InAttendance + counts.Stopped;
    const countsPerUrgency = {};
    const countsPerOwner = {};
    tickets.forEach(t=>{
        countsPerUrgency[t.urgency] = (countsPerUrgency[t.urgency]||0)+1;
        countsPerOwner[t.owner] = (countsPerOwner[t.owner]||0)+1;
    });
    return { counts, countsPerUrgency, countsPerOwner, tickets };
};

let lastGoodPayload = null;

/* endpoint tickets */
app.get("/api/tickets", async (req, res) => {
    try {
        if (!MOVI_TOKEN) {
            return res.json(makeMockPayload());
        }

        const userTeam = req.session.team;
        if (!userTeam) {
            return res.json({ counts:{}, countsPerUrgency:{}, countsPerOwner:{}, tickets:[] });
        }


        const todayLocalISO = ymd(new Date());

    // Busca apenas tickets ativos: New, InAttendance, Stopped
    let filter = `ownerTeam eq '${userTeam}' and (baseStatus eq 'New' or baseStatus eq 'InAttendance' or baseStatus eq 'Stopped')`;

        const url =
            `${MOVI_URL}?token=${MOVI_TOKEN}&$top=500` +
            `&$select=id,subject,urgency,baseStatus,status,ownerTeam,createdDate,closedIn,slaSolutionDate` +
            `&$expand=owner($select=id,businessName),customFieldValues` +
            `&$filter=${encodeURIComponent(filter)}`;

        const { data } = await axios.get(url, { timeout: 15000 });


        const tickets = data.map((t) => {
            let prevISO = null;
            if (t.slaSolutionDate) {
                const d = new Date(t.slaSolutionDate);
                if (!isNaN(d)) prevISO = ymd(d);
            }
            if (!prevISO) {
                const forecastRaw = getForecastRaw(t);
                const forecastDate = parseAnyDate(forecastRaw);
                prevISO = forecastDate ? ymd(forecastDate) : null;
            }
            const inactive = isInactive(t);
            const { overdue, daysUntilDue, dueCategory } = getDueInfo(prevISO, inactive, todayLocalISO);
            return {
                id: t.id,
                subject: t.subject,
                urgency: t.urgency || "Não definida",
                baseStatus: t.baseStatus,
                status: t.status || "Não definido",
                owner: t.owner?.businessName || "Não atribuído",
                ownerTeam: t.ownerTeam || "Não definido",
                createdDate: t.createdDate,
                previsaoSolucao: prevISO,
                overdue,
                daysUntilDue,
                dueCategory,
                canceled: isCanceled(t),
            };
        });

        // Log para debug: mostra os status dos tickets retornados
        console.log("Tickets retornados:");
        tickets.forEach(t => {
            console.log(`#${t.id} | baseStatus: ${t.baseStatus} | status: ${t.status} | canceled: ${t.canceled}`);
        });

        // Calcula tickets criados no mês vigente
        const hoje = new Date();
        const mesAtual = hoje.getMonth();
        const anoAtual = hoje.getFullYear();
        const ticketsMes = tickets.filter(t => {
            if (!t.createdDate) return false;
            const d = new Date(t.createdDate);
            return d.getMonth() === mesAtual && d.getFullYear() === anoAtual;
        });

        const counts = {
            Total: tickets.filter((t) => !t.canceled).length,
            New: tickets.filter((t) => t.baseStatus === "New" && !t.canceled).length,
            InAttendance: tickets.filter((t) => t.baseStatus === "InAttendance" && !t.canceled).length,
            Stopped: tickets.filter((t) => t.baseStatus === "Stopped" && !t.canceled).length,
            Closed: tickets.filter((t) => isClosedOrResolved(t) && !t.canceled).length,
            Overdue: tickets.filter((t) => t.overdue && !t.canceled).length,
            MonthOpenedAll: ticketsMes.length,
        };
        counts.OpenTickets = counts.New + counts.InAttendance + counts.Stopped;

        const countsPerUrgency = {};
        const countsPerOwner = {};
        tickets.forEach((t) => {
            if (isInactive(t)) return;
            countsPerUrgency[t.urgency] = (countsPerUrgency[t.urgency] || 0) + 1;
            countsPerOwner[t.owner] = (countsPerOwner[t.owner] || 0) + 1;
        });

        lastGoodPayload = { counts, countsPerUrgency, countsPerOwner, tickets };
        res.json(lastGoodPayload);
    } catch (err) {
        console.error("❌ Erro ao buscar tickets:", err.message);
        if (lastGoodPayload) {
            console.warn("⚠ Sem conexão. Enviando último payload válido.");
            return res.json(lastGoodPayload);
        }
        return res.json(makeMockPayload());
    }
});

/* static files */
app.use(express.static("public"));

/* start */
app.listen(PORT, () => console.log(`✅ Servidor rodando em http://localhost:${PORT}`));
