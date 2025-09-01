import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const MOVI_TOKEN = encodeURIComponent(process.env.MOVI_TOKEN);
const MOVI_URL = "https://api.movidesk.com/public/v1/tickets";

async function testar() {
    try {
        const { data } = await axios.get(
            `${MOVI_URL}?token=${MOVI_TOKEN}&$top=1&$select=id,subject,status`
        );
        console.log("✅ Funcionou:", data);
    } catch (err) {
        console.error("❌ Erro:", err.response?.data || err.message);
    }
}

testar();
