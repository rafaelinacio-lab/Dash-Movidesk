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
  port: process.env.DB_PORT || 5432, // MariaDB nessa porta
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

const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;
const VALID_ORDER_COLUMNS = new Set(["novos", "atendimento", "parados", "vencidos"]);

/* ----------------- Login ------------------- */
app.get("/", (req, res) => {
  if (!req.session.userId) {
    return res.sendFile(path.join(__dirname, "public/login.html"));
  }
  res.redirect("/dashboard");
});

/* ================== SERVICE TICKETS (RELATÓRIO) ================== */
/* Busca SOMENTE por serviceFirstLevel e traz o valor do campo customizado configurado no BD */
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Não autenticado" });
  next();
}

/* ================== ALTERADO AQUI ================== */
/* ================== /api/service-tickets (ATUALIZADA) ================== */
app.get("/api/service-tickets", requireAuth, async (req, res) => {
  try {
    const raw = (req.query.service || "").trim();
    const { start, end, status } = req.query;
    if (!raw) return res.status(400).json({ error: "Parâmetro service obrigatório" });

    // considera apenas o 1º nível do caminho (ex.: "Agronegócio" de "Oracle Cloud » Agronegócio")
    const [firstLevel] = raw.split("»").map(s => s.trim()).filter(Boolean);

    // status agrupados:
    // PENDENTE: tudo que NÃO é Closed/Resolved/Cancelled
    // FINALIZADO: Closed OU Resolved
    // CANCELADO:  Canceled/Cancelled
    const statusFilter = (() => {
      const s = String(status || "").toUpperCase();
      if (s === "FINALIZADO") {
        return "(baseStatus eq 'Closed' or baseStatus eq 'Resolved')";
      }
      if (s === "CANCELADO") {
        return "(baseStatus eq 'Canceled' or baseStatus eq 'Cancelled')";
      }
      if (s === "PENDENTE") {
        return "(baseStatus ne 'Closed' and baseStatus ne 'Resolved' and baseStatus ne 'Canceled' and baseStatus ne 'Cancelled')";
      }
      return ""; // (todos)
    })();

    // evita quebra de OData com aspas simples
    const escapeOData = (v) => String(v).replace(/'/g, "''");

    const parts = [];
    if (firstLevel) parts.push(`serviceFull/any(s: s eq '${escapeOData(firstLevel)}')`);
    if (start) parts.push(`createdDate ge ${start}T00:00:00.000Z`);
    if (end)   parts.push(`createdDate le ${end}T23:59:59.999Z`);
    if (statusFilter) parts.push(statusFilter);
    const filter = parts.join(" and ");

    // pedimos campos extras: owner, closedIn, slaSolutionDate e actions
    const url =
      `${MOVI_URL}?token=${MOVI_TOKEN}&$top=500` +
      `&$select=id,subject,status,baseStatus,ownerTeam,createdDate,closedIn,slaSolutionDate,serviceFull` +
      `&$expand=owner($select=id,businessName),customFieldValues($expand=items),actions` +
      `&$filter=${encodeURIComponent(filter)}`;

    const { data = [] } = await axios.get(url, { timeout: 15000 });

    // Descobre qual customFieldId usar para este serviço (se houver cadastro)
    let expectedFieldId = null;
    try {
      const [rows] = await db.query(
        "SELECT customFieldId FROM service_custom_fields WHERE service = ? LIMIT 1",
        [firstLevel]
      );
      if (rows.length) expectedFieldId = Number(rows[0].customFieldId);
    } catch (e) {
      console.warn("CF lookup falhou:", e.message);
    }

    // utilitário
    const coalesce = (...vals) => {
      for (const v of vals) {
        if (v !== undefined && v !== null && String(v).trim() !== "") return v;
      }
      return null;
    };

    // tenta achar a data em que virou "Resolvido" nas ações
    const getSolvedFromActions = (t) => {
      const acts = Array.isArray(t.actions) ? t.actions : [];
      // os objetos podem variar entre: action.status, action.toStatus, action.baseStatus
      const isResolved = (a) => {
        const cand = (a.status || a.toStatus || a.baseStatus || "").toString().toLowerCase();
        return cand.includes("resolv"); // "Resolvido" / "Resolved"
      };
      const resolvedActs = acts.filter(isResolved).sort((a, b) => {
        const da = new Date(a.createdDate).getTime() || 0;
        const db = new Date(b.createdDate).getTime() || 0;
        return da - db;
      });
      return resolvedActs.length ? resolvedActs[0].createdDate : null;
    };

    const tickets = data.map(t => {
      // owner
      const owner = t.owner?.businessName || "Não atribuído";

      // previsão de solução (seu front já mostra)
      let previsaoSolucao = null;
      if (t.slaSolutionDate) {
        const d = new Date(t.slaSolutionDate);
        if (!isNaN(d)) previsaoSolucao = d.toISOString();
      }

      // data de solução final:
      // 1) se tiver closedIn, usamos
      // 2) senão, tenta pegar quando virou "Resolvido" nas ações
      let solvedDate = t.closedIn || null;
      if (!solvedDate) {
        const fromActs = getSolvedFromActions(t);
        if (fromActs) solvedDate = fromActs;
      }

      // extrai o "Módulo x Rotina"
      let moduloRotina = null;
      if (expectedFieldId) {
        const match = (t.customFieldValues || []).find(cf => Number(cf.customFieldId) === expectedFieldId);
        if (match) {
          if (Array.isArray(match.items) && match.items.length > 0) {
            moduloRotina = match.items.map(i => i.customFieldItem).filter(Boolean).join(", ");
          } else {
            moduloRotina = coalesce(match.customFieldItem, match.value, match.valueText, match.text);
          }
        }
      } else {
        const first = (t.customFieldValues || []).find(cf =>
          coalesce(cf.customFieldItem, cf.value, cf.valueText, cf.text)
        );
        moduloRotina = first ? coalesce(first.customFieldItem, first.value, first.valueText, first.text) : null;
      }

      // serviceFirstLevel para o front (pega o 1º item do array serviceFull)
      const serviceFirstLevel = Array.isArray(t.serviceFull) && t.serviceFull.length ? String(t.serviceFull[0]) : null;

      return {
        id: t.id,
        subject: t.subject,
        status: t.status,
        baseStatus: t.baseStatus,
        owner,
        ownerTeam: t.ownerTeam,
        createdDate: t.createdDate,
        closedIn: t.closedIn || null,
        solvedDate,                // << usado pelo front
        previsaoSolucao,          // << usado pelo front
        serviceFirstLevel,
        serviceFull: t.serviceFull || [],
        customFieldValue: moduloRotina || null
      };
    });

    const counts = {
      total: tickets.length,
      new: tickets.filter(t => t.baseStatus === "New").length,
      inAttendance: tickets.filter(t => t.baseStatus === "InAttendance").length,
      stopped: tickets.filter(t => t.baseStatus === "Stopped").length,
      closed: tickets.filter(t => ["Closed", "Resolved"].includes(t.baseStatus)).length,
      canceled: tickets.filter(t => ["Canceled", "Cancelled"].includes(t.baseStatus)).length,
    };

    res.json({
      service: raw,
      serviceFirstLevel: firstLevel,
      counts,
      tickets
    });
  } catch (err) {
    console.error("❌ Erro ao buscar tickets por serviço:", err.message);
    res.status(500).json({ error: "Falha ao consultar tickets" });
  }
});
/* ================== /FIM ================== */


/* ---------------- Login e páginas ---------------- */
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

    const must = user.must_change_password === 1 || user.must_change_password === true;
    res.json({ success: true, mustChangePassword: !!must, message: "Login realizado com sucesso" });
  } catch (err) {
    console.error("❌ Erro login:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

app.get("/dashboard", async (req, res) => {
  if (!req.session.userId) return res.redirect("/");
  try {
    const [rows] = await db.query("SELECT must_change_password FROM users WHERE id = ?", [req.session.userId]);
    if (rows.length && (rows[0].must_change_password === 1 || rows[0].must_change_password === true)) {
      return res.redirect("/password");
    }
  } catch {}
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Página de troca de senha
app.get("/password", (req, res) => {
  if (!req.session.userId) return res.redirect("/");
  res.sendFile(path.join(__dirname, "public", "password.html"));
});

// API: trocar senha (inclui primeiro login)
app.post("/api/change-password", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Não autenticado" });
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: "Nova senha muito curta" });
  }
  try {
    const [rows] = await db.query("SELECT id, password_hash, must_change_password FROM users WHERE id = ?", [req.session.userId]);
    if (!rows.length) return res.status(404).json({ error: "Usuário não encontrado" });
    const user = rows[0];
    const must = user.must_change_password === 1 || user.must_change_password === true;
    if (!must) {
      if (!currentPassword) return res.status(400).json({ error: "Informe a senha atual" });
      const ok = await bcrypt.compare(currentPassword, user.password_hash);
      if (!ok) return res.status(401).json({ error: "Senha atual incorreta" });
    }
    const newHash = await bcrypt.hash(newPassword, 10);
    await db.query(
      "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?",
      [newHash, req.session.userId]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error("Erro ao trocar senha:", err);
    return res.status(500).json({ error: "Erro ao trocar senha" });
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

/* ---------------- Middleware extra ---------------- */
function requireAdmin(req, res, next) {
  if (!req.session.userId || req.session.role !== "admin") {
    return res.status(403).send("Acesso negado");
  }
  next();
}
function requireSupervisor(req, res, next) {
  if (!req.session.userId || (req.session.role !== "admin" && req.session.role !== "supervisor")) {
    return res.status(403).send("Acesso negado");
  }
  next();
}

/* ---------------- Rotas de Usuário ---------------- */
app.get("/reports", requireSupervisor, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "reports.html"));
});
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

app.get("/api/ticket/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const url =
      `${MOVI_URL}?token=${MOVI_TOKEN}`
      + `&$select=id,subject,status,owner,ownerTeam,createdDate,customFieldValues,clients,actions`
      + `&$expand=owner($select=id,businessName),clients($select=id,businessName;$expand=organization($select=businessName)),actions($expand=createdBy($select=businessName))`
      + `&$filter=id eq ${id}`;
    const { data } = await axios.get(url, { timeout: 15000 });
    if (data.length === 0) {
      return res.status(404).json({ error: "Ticket não encontrado" });
    }
    const ticket = data[0];
    const owner = ticket.owner?.businessName || "Não atribuído";
    const ownerTeam = ticket.ownerTeam || "Não definido";
    const createdDate = ticket.createdDate;
    const subject = ticket.subject;
    const status = ticket.status;
    const requester = ticket.clients?.[0]?.businessName || "Não informado";
    const requesterOrganization = ticket.clients?.[0]?.organization?.businessName || "Não informado";
    const actions = (ticket.actions || []).map(action => ({
      description: action.description,
      createdBy: action.createdBy?.businessName || "Não informado",
      createdDate: action.createdDate
    }));

    res.json({
      id: ticket.id,
      subject,
      status,
      owner,
      ownerTeam,
      createdDate,
      requester,
      requesterOrganization,
      actions
    });
  } catch (err) {
    console.error(`Erro ao buscar ticket ${id}:`, err.message);
    res.status(404).json({ error: "Ticket não encontrado" });
  }
});

/* ------------- Preferências de Card ------------- */
app.get("/api/card-colors", requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT ticket_id, color FROM user_card_colors WHERE user_id = ?",
      [req.session.userId]
    );
    const colors = {};
    for (const row of rows) {
      if (row && row.ticket_id && typeof row.color === "string" && HEX_COLOR_REGEX.test(row.color)) {
        colors[row.ticket_id] = row.color.toLowerCase();
      }
    }
    res.json(colors);
  } catch (err) {
    console.error("Erro ao buscar cores personalizadas:", err);
    res.status(500).json({ error: "Erro ao carregar preferências" });
  }
});

app.post("/api/card-colors", requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const body = req.body || {};
  const ticketKey = String(body.ticketId || "").trim();
  const rawColor = typeof body.color === "string" ? body.color.trim() : "";

  if (!ticketKey) {
    return res.status(400).json({ error: "Ticket inválido" });
  }

  const normalizedColor = HEX_COLOR_REGEX.test(rawColor) ? rawColor.toLowerCase() : null;

  try {
    if (!normalizedColor) {
      await db.query(
        "DELETE FROM user_card_colors WHERE user_id = ? AND ticket_id = ?",
        [userId, ticketKey]
      );
      return res.json({ success: true, color: null });
    }

    await db.query(
      `INSERT INTO user_card_colors (user_id, ticket_id, color)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE color = VALUES(color)`,
      [userId, ticketKey, normalizedColor]
    );

    res.json({ success: true, color: normalizedColor });
  } catch (err) {
    console.error("Erro ao salvar cor personalizada:", err);
    res.status(500).json({ error: "Erro ao salvar preferências" });
  }
});

app.get("/api/ticket-order", requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT column_key, ticket_order FROM user_ticket_orders WHERE user_id = ?",
      [req.session.userId]
    );
    const result = {};
    for (const row of rows) {
      if (!row || !row.column_key) continue;
      try {
        const parsed = JSON.parse(row.ticket_order || "[]");
        if (Array.isArray(parsed)) {
          result[row.column_key] = parsed.map((id) => String(id));
        }
      } catch (err) {
        console.warn("Erro ao analisar ordem salva para coluna", row.column_key, err.message);
      }
    }
    res.json(result);
  } catch (err) {
    console.error("Erro ao buscar ordem de tickets:", err);
    res.status(500).json({ error: "Erro ao carregar ordem de tickets" });
  }
});

app.post("/api/ticket-order", requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const body = req.body || {};
  const columnKey = String(body.columnKey || "").trim();
  const order = Array.isArray(body.order) ? body.order.map((id) => String(id).trim()).filter(Boolean) : null;

  if (!VALID_ORDER_COLUMNS.has(columnKey)) {
    return res.status(400).json({ error: "Coluna inválida" });
  }
  if (!order) {
    return res.status(400).json({ error: "Ordem inválida" });
  }

  try {
    if (order.length === 0) {
      await db.query(
        "DELETE FROM user_ticket_orders WHERE user_id = ? AND column_key = ?",
        [userId, columnKey]
      );
      return res.json({ success: true, order: [] });
    }

    await db.query(
      `INSERT INTO user_ticket_orders (user_id, column_key, ticket_order)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE ticket_order = VALUES(ticket_order)`,
      [userId, columnKey, JSON.stringify(order)]
    );

    res.json({ success: true, order });
  } catch (err) {
    console.error("Erro ao salvar ordem de tickets:", err);
    res.status(500).json({ error: "Erro ao salvar ordem de tickets" });
  }
});

/* ---------------- Rotas Admin ---------------- */
app.get("/admin/users", requireAdmin, async (req, res) => {
  const [rows] = await db.query("SELECT id, username, team, role FROM users");
  res.json(rows);
});

// Criação de usuário pelo Admin
app.post("/admin/users/create", requireAdmin, async (req, res) => {
  try {
    const { username, password, team, role, mustChangePassword } = req.body || {};
    if (!username || !password || !team || !role) {
      return res.status(400).json({ error: "Campos obrigatórios ausentes" });
    }
    const [exists] = await db.query("SELECT id FROM users WHERE username = ? LIMIT 1", [username]);
    if (exists.length) {
      return res.status(409).json({ error: "Usuário já existe" });
    }
    const password_hash = await bcrypt.hash(password, 10);
    const must = mustChangePassword ? 1 : 0;
    await db.query(
      "INSERT INTO users (username, password_hash, role, team, must_change_password) VALUES (?, ?, ?, ?, ?)",
      [username, password_hash, role, team, must]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error("Erro ao criar usuário:", err);
    return res.status(500).json({ error: "Erro ao criar usuário" });
  }
});

// Atualização de usuário (equipe/role/must_change_password)
app.post("/admin/users/update", requireAdmin, async (req, res) => {
  try {
    const { userId, team, role, mustChangePassword } = req.body || {};
    if (!userId || !team || !role) {
      return res.status(400).json({ error: "Campos obrigatórios ausentes" });
    }
    const must = typeof mustChangePassword === "boolean" ? (mustChangePassword ? 1 : 0) : undefined;
    if (must === undefined) {
      await db.query("UPDATE users SET team = ?, role = ? WHERE id = ?", [team, role, userId]);
    } else {
      await db.query("UPDATE users SET team = ?, role = ?, must_change_password = ? WHERE id = ?", [team, role, must, userId]);
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("Erro ao atualizar usuário:", err);
    return res.status(500).json({ error: "Erro ao atualizar usuário" });
  }
});

// Exclusão de usuário
app.post("/admin/users/delete", requireAdmin, async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: "userId obrigatório" });
    await db.query("DELETE FROM users WHERE id = ?", [userId]);
    return res.json({ success: true });
  } catch (err) {
    console.error("Erro ao excluir usuário:", err);
    return res.status(500).json({ error: "Erro ao excluir usuário" });
  }
});

/* ================== CUSTOM FIELDS ADMIN ================== */
app.get("/api/custom-fields", requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM service_custom_fields ORDER BY service");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Erro ao listar custom fields" });
  }
});

app.post("/api/custom-fields", requireAdmin, async (req, res) => {
  const { service, customFieldId, customFieldRuleId } = req.body;
  if (!service || !customFieldId || !customFieldRuleId) {
    return res.status(400).json({ error: "Campos obrigatórios ausentes" });
  }
  try {
    await db.query(
      `INSERT INTO service_custom_fields (service, customFieldId, customFieldRuleId)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE customFieldId=VALUES(customFieldId), customFieldRuleId=VALUES(customFieldRuleId)`,
      [service, customFieldId, customFieldRuleId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Erro ao salvar" });
  }
});

app.delete("/api/custom-fields/:id", requireAdmin, async (req, res) => {
  try {
    const [r] = await db.query("DELETE FROM service_custom_fields WHERE id = ?", [req.params.id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: "Registro não encontrado" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Erro ao excluir" });
  }
});

/* ---------------- Movidesk ----------------- */
const MOVI_TOKEN = (process.env.MOVI_TOKEN || "").trim();
const MOVI_URL = (process.env.MOVI_URL || "https://api.movidesk.com/public/v1/tickets").trim();
try { dns.setDefaultResultOrder("ipv4first"); } catch {}

/* ===== Utilidades ===== */
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

/* endpoint tickets (kanban) – mantido igual ao seu atual */
app.get("/api/tickets", async (req, res) => {
  try {
    if (!MOVI_TOKEN) {
      const base = makeMockPayload();
      const ownerQ = (req.query.owner || "").toString();
      if (!ownerQ) return res.json(base);
      const norm = (s)=> (s||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
      const filteredTickets = (base.tickets||[]).filter(t => norm(t.owner||'') === norm(ownerQ));
      const hoje = new Date(); const mesAtual = hoje.getMonth(); const anoAtual = hoje.getFullYear();
      const ticketsMes = filteredTickets.filter(t=>{ if(!t.createdDate) return false; const d=new Date(t.createdDate); return d.getMonth()===mesAtual && d.getFullYear()===anoAtual; });
      const counts = {
        Total: filteredTickets.filter(t=>!t.canceled).length,
        New: filteredTickets.filter(t=>t.baseStatus==='New' && !t.canceled).length,
        InAttendance: filteredTickets.filter(t=>t.baseStatus==='InAttendance' && !t.canceled).length,
        Stopped: filteredTickets.filter(t=>t.baseStatus==='Stopped' && !t.canceled).length,
        Closed: filteredTickets.filter(t=> (t.baseStatus==='Closed'||t.baseStatus==='Resolved') && !t.canceled).length,
        Overdue: filteredTickets.filter(t=>t.overdue && !t.canceled).length,
        MonthOpenedAll: ticketsMes.length,
      };
      counts.OpenTickets = counts.New + counts.InAttendance + counts.Stopped;
      const countsPerUrgency = {}; const countsPerOwner = {};
      filteredTickets.forEach(t=>{ countsPerUrgency[t.urgency]=(countsPerUrgency[t.urgency]||0)+1; countsPerOwner[t.owner]=(countsPerOwner[t.owner]||0)+1; });
      return res.json({ counts, countsPerUrgency, countsPerOwner, tickets: filteredTickets });
    }

    const userTeam = req.session.team;
    if (!userTeam) {
      return res.json({ counts:{}, countsPerUrgency:{}, countsPerOwner:{}, tickets:[] });
    }

    const todayLocalISO = ymd(new Date());

    // Busca apenas tickets ativos: New, InAttendance, Stopped
    let filter = `ownerTeam eq '${userTeam}' and (baseStatus eq 'New' or baseStatus eq 'InAttendance' or baseStatus eq 'Stopped')`;

    const url =
      `${MOVI_URL}?token=${MOVI_TOKEN}&$top=500`
      + `&$select=id,subject,urgency,baseStatus,status,ownerTeam,createdDate,closedIn,slaSolutionDate,serviceFull`
      + `&$expand=owner($select=id,businessName),customFieldValues`
      + `&$filter=${encodeURIComponent(filter)}`;

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
        serviceFull: t.serviceFull || [],
      };
    });

    console.log("Tickets retornados:");
    tickets.forEach(t => {
      console.log(`#${t.id} | baseStatus: ${t.baseStatus} | status: ${t.status} | canceled: ${t.canceled}`);
    });

    const ownerQ = (req.query.owner || "").toString();
    const norm = (s)=> (s||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
    let effTickets = tickets;
    if (ownerQ) {
      const target = norm(ownerQ);
      effTickets = tickets.filter(t => norm(t.owner||'') === target);
    }

    const hoje = new Date();
    const mesAtual = hoje.getMonth();
    const anoAtual = hoje.getFullYear();
    const ticketsMes = effTickets.filter(t => {
      if (!t.createdDate) return false;
      const d = new Date(t.createdDate);
      return d.getMonth() === mesAtual && d.getFullYear() === anoAtual;
    });

    const counts = {
      Total: effTickets.filter((t) => !t.canceled).length,
      New: effTickets.filter((t) => t.baseStatus === "New" && !t.canceled).length,
      InAttendance: effTickets.filter((t) => t.baseStatus === "InAttendance" && !t.canceled).length,
      Stopped: effTickets.filter((t) => t.baseStatus === "Stopped" && !t.canceled).length,
      Closed: effTickets.filter((t) => isClosedOrResolved(t) && !t.canceled).length,
      Overdue: effTickets.filter((t) => t.overdue && !t.canceled).length,
      MonthOpenedAll: ticketsMes.length,
    };
    counts.OpenTickets = counts.New + counts.InAttendance + counts.Stopped;

    const countsPerUrgency = {};
    const countsPerOwner = {};
    effTickets.forEach((t) => {
      if (isInactive(t)) return;
      countsPerUrgency[t.urgency] = (countsPerUrgency[t.urgency] || 0) + 1;
      countsPerOwner[t.owner] = (countsPerOwner[t.owner] || 0) + 1;
    });

    lastGoodPayload = { counts, countsPerUrgency, countsPerOwner, tickets: effTickets };
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

/* Rotas melhorias */
app.get("/api/melhorias", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT id, titulo, descricao, autor, status, created_at FROM melhorias ORDER BY created_at DESC");
    const melhorias = rows.map((row) => ({
      id: row.id,
      titulo: row.titulo,
      descricao: row.descricao,
      autor: row.autor,
      status: row.status || 'Enviada',
      data: row.created_at ? new Date(row.created_at).toISOString() : null,
    }));
    res.json(melhorias);
  } catch (err) {
    console.error('Erro ao carregar melhorias:', err);
    res.status(500).json({ error: 'Erro ao carregar melhorias' });
  }
});

app.post("/api/melhorias/status", async (req, res) => {
  const { id, status } = req.body;
  if (!id || !status) return res.status(400).json({ error: 'Dados obrigatórios' });
  try {
    const [result] = await db.query("UPDATE melhorias SET status = ?, updated_at = NOW() WHERE id = ?", [status, id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Melhoria não encontrada' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao atualizar melhoria:', err);
    res.status(500).json({ error: 'Erro ao atualizar melhoria' });
  }
});

app.post("/api/melhorias/sugerir", async (req, res) => {
  const { titulo, descricao, autor } = req.body;
  if (!titulo || !descricao || !autor) {
    return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  }
  try {
    const [result] = await db.query("INSERT INTO melhorias (titulo, descricao, autor) VALUES (?, ?, ?)", [titulo, descricao, autor]);
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    console.error('Erro ao salvar melhoria:', err);
    res.status(500).json({ error: 'Erro ao salvar melhoria' });
  }
});

/* static files e start */
app.use(express.static("public"));
app.listen(PORT, () => console.log(`✅ Servidor rodando em http://localhost:${PORT}`));

