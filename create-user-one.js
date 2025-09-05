import dotenv from "dotenv";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import crypto from "node:crypto";

dotenv.config();

const ALLOWED_ROLES = new Set(["user", "admin", "inactive"]);

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

// Gera senha aleatória forte
function generatePassword(length = 12) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+";
    const bytes = crypto.randomBytes(length);
    let pass = "";
    for (let i = 0; i < length; i++) pass += chars[bytes[i] % chars.length];
    return pass;
}

async function main() {
    // Modo interativo quando executado sem todos os argumentos
    const args = process.argv.slice(2);

    if (args.length === 0) {
        const rl = readline.createInterface({ input, output });
        try {
            // Usuário
            let username = (await rl.question("Usuário: ")).trim();
            while (!username) username = (await rl.question("Usuário (obrigatório): ")).trim();

            // Equipe
            let team = (await rl.question("Equipe: ")).trim();
            while (!team) team = (await rl.question("Equipe (obrigatória): ")).trim();

            // Role
            let role = (await rl.question("Role [user/admin/inactive] (padrão: user): ")).trim().toLowerCase();
            if (!role) role = "user";
            while (!ALLOWED_ROLES.has(role)) {
                role = (await rl.question("Role inválida. Use user/admin/inactive: ")).trim().toLowerCase();
            }

            // Senha sugerida + opção de sobrescrever
            const suggested = generatePassword(12);
            const custom = (await rl.question(`Senha sugerida (${suggested}) — pressione Enter para aceitar ou digite outra: `)).trim();
            const password = custom || suggested;

            // Confirmação
            console.log("\nResumo:");
            console.log(`  Usuário: ${username}`);
            console.log(`  Equipe:  ${team}`);
            console.log(`  Role:    ${role}`);
            console.log(`  Senha:   ${password}`);
            const confirm = (await rl.question("Confirmar criação? [s/N]: ")).trim().toLowerCase();
            if (confirm !== "s" && confirm !== "sim" && confirm !== "y" && confirm !== "yes") {
                console.log("Cancelado.");
                await rl.close();
                return;
            }

            await createUser(username, password, role, team);
            console.log("\nAnote a senha acima.\n");
            await rl.close();
        } catch (e) {
            console.error("Erro no modo interativo:", e.message);
        }
        return;
    }

    // Modo não interativo (compatível com args antigos)
    // Uso: node create-user-one.js <usuario> <senha> [role=user|admin|inactive] <equipe...>
    const [u, p, ...rest] = args;
    let roleArg = "user";
    let t = null;
    if (rest.length > 0) {
        if (ALLOWED_ROLES.has(rest[0])) {
            roleArg = rest[0];
            t = rest.slice(1).length ? rest.slice(1).join(" ") : null;
        } else {
            t = rest.join(" ");
        }
    }
    if (!u || !p || !t) {
        console.error("Uso: node create-user-one.js <usuario> <senha> [role=user|admin|inactive] <equipe...>");
        process.exit(1);
    }
    await createUser(u, p, roleArg, t);
}

main();
