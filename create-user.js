import dotenv from "dotenv";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";

dotenv.config();

async function createUser(username, password, role = "user", team = null) {
    try {
        // Conexão com MariaDB
        const db = await mysql.createConnection({
            host: process.env.DB_HOST || "192.168.91.168",
            port: process.env.DB_PORT || 5432,
            user: process.env.DB_USER || "root",
            password: process.env.DB_PASS || "V!@soft2025#@2306",
            database: process.env.DB_NAME || "si_panel",
        });

        // Gera hash da senha
        const hash = await bcrypt.hash(password, 10);

        // Insere no banco
        const [result] = await db.query(
            "INSERT INTO users (username, password_hash, role, team) VALUES (?, ?, ?, ?)",
            [username, hash, role, team]
        );

        console.log(`✅ Usuário criado com sucesso! ID: ${result.insertId}`);
        console.log(`👤 Usuário: ${username}`);
        console.log(`🔑 Role: ${role}`);
        console.log(`👥 Equipe: ${team || "Nenhuma atribuída"}`);

        await db.end();
    } catch (err) {
        console.error("❌ Erro ao criar usuário:", err.message);
    }
}

// === Exemplo de uso ===
// node create-user.js <usuario> <senha> <role> <equipe...>
// Ex: node create-user.js rafael.inacio 123456 admin VIASOFT - Sistemas Internos

const [,, u, p, r, ...teamParts] = process.argv;
const t = teamParts.length ? teamParts.join(" ") : null;

if (!u || !p) {
    console.error("Uso: node create-user.js <usuario> <senha> [role=user|admin] [equipe...]");
    process.exit(1);
}
createUser(u, p, r || "user", t);
