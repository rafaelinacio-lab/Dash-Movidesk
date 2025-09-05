// create-user-one.js (ESM)
// Uso:
//   node create-user-one.js <usuario> <senha> [role=user|admin|inactive] "<equipe>"
// Exemplos (PowerShell):
//   node create-user-one.js rafael "Senha#2025" admin "VIASOFT - Sistemas Internos"
//   node create-user-one.js ana "123456" "Agrotitan - Suporte"   // role padrão = user

import dotenv from "dotenv";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";

dotenv.config();

function usage() {
  console.log('Uso: node create-user-one.js <usuario> <senha> [role=user|admin|inactive] "<equipe>"');
}

const args = process.argv.slice(2);
if (args.length < 3) {
  usage();
  process.exit(1);
}

let [username, password, third, fourth] = args;

// Detecta se o 3º argumento é role ou já é a equipe
let role = "user";
let team = null;

if (fourth !== undefined) {
  // formato explícito: <user> <pass> <role> "<team>"
  const m = /^role=(.+)$/i.exec(third);
  role = (m ? m[1] : third).toLowerCase();
  team = fourth;
} else {
  // formato curto: <user> <pass> "<team>"  (role = user)
  team = third;
}

if (!["user", "admin", "inactive"].includes(role)) {
  console.error("❌ Role inválido. Use user | admin | inactive.");
  usage();
  process.exit(1);
}

team = String(team || "").trim();
if (!team) {
  console.error("❌ Informe a equipe (entre aspas se tiver espaços).");
  usage();
  process.exit(1);
}

const db = await mysql.createPool({
  host: process.env.DB_HOST || "192.168.91.168",
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432, // igual ao seu server.js
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASS || "V!@soft2025#@2306",
  database: process.env.DB_NAME || "si_panel",
  connectionLimit: 5,
});

async function ensureSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_teams (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      team VARCHAR(255) NOT NULL,
      UNIQUE KEY uniq_user_team (user_id, team),
      INDEX idx_user_teams_user (user_id),
      CONSTRAINT fk_user_teams_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

(async () => {
  try {
    await ensureSchema();

    // já existe?
    const [exist] = await db.query("SELECT id FROM users WHERE username = ?", [username]);
    if (exist.length) {
      console.error("❌ Usuário já existe:", username);
      process.exit(2);
    }

    const password_hash = await bcrypt.hash(password, 10);

    // cria usuário (coluna 'team' recebe a equipe informada)
    const [ins] = await db.query(
      "INSERT INTO users (username, password_hash, role, team) VALUES (?, ?, ?, ?)",
      [username, password_hash, role, team]
    );
    const userId = ins.insertId;

    // vincula única equipe
    await db.query("INSERT IGNORE INTO user_teams (user_id, team) VALUES (?, ?)", [userId, team]);

    console.log("✅ Usuário criado com sucesso!");
    console.log("   ID:      ", userId);
    console.log("   Usuário: ", username);
    console.log("   Role:    ", role);
    console.log("   Equipe:  ", team);
    process.exit(0);
  } catch (err) {
    console.error("❌ Erro:", err.message);
    console.error("   Dica: se o erro for 'Data too long for column role', ajuste a coluna:");
    console.error("   ALTER TABLE users MODIFY COLUMN role ENUM('user','admin','inactive') NOT NULL DEFAULT 'user';");
    process.exit(3);
  } finally {
    await db.end();
  }
})();
