from flask import Flask, jsonify
import requests
import sqlite3
import schedule
import time
import threading

app = Flask(__name__)

# Configurações do Movidesk
MOVIDESK_API_KEY = 'SUA_CHAVE_DE_API_AQUI'
MOVIDESK_API_URL = f'https://api.movidesk.com/public/v1/tickets?token={MOVIDESK_API_KEY}'

# Nome do banco de dados temporário
DB_NAME = 'movidesk_data.db'

def setup_database():
    """Cria a tabela para armazenar os dados se ela não existir."""
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS tickets (
            id INTEGER PRIMARY KEY,
            subject TEXT,
            status TEXT,
            created_date TEXT,
            priority TEXT,
            sla_agreement TEXT,
            # Adicione outras colunas conforme a necessidade
            UNIQUE(id)
        )
    ''')
    conn.commit()
    conn.close()

def fetch_and_store_data():
    """Busca os dados da API e os armazena no banco de dados."""
    print("Buscando dados da API do Movidesk...")
    try:
        response = requests.get(MOVIDESK_API_URL)
        response.raise_for_status()
        tickets = response.json()

        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()

        # Limpa os dados existentes antes de inserir os novos
        cursor.execute('DELETE FROM tickets')

        for ticket in tickets:
            cursor.execute('''
                INSERT OR IGNORE INTO tickets (id, subject, status, created_date, priority, sla_agreement)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (
                ticket.get('id'),
                ticket.get('subject'),
                ticket.get('status'),
                ticket.get('createdDate'),
                ticket.get('urgencyName'),
                ticket.get('slaAgreement')
            ))
        
        conn.commit()
        conn.close()
        print("Dados armazenados com sucesso!")

    except requests.exceptions.RequestException as e:
        print(f"Erro ao buscar dados: {e}")

def delete_data_at_eod():
    """Exclui todos os dados do banco de dados temporário."""
    print("Excluindo dados do servidor...")
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute('DELETE FROM tickets')
    conn.commit()
    conn.close()
    print("Dados excluídos com sucesso!")

@app.route('/api/dashboard-data', methods=['GET'])
def get_dashboard_data():
    """Endpoint para o frontend acessar os dados."""
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM tickets')
    data = cursor.fetchall()
    conn.close()

    # Formata os dados para um formato JSON mais amigável
    columns = [desc[0] for desc in cursor.description]
    data_json = [dict(zip(columns, row)) for row in data]

    return jsonify(data_json)

def run_scheduler():
    """Função para rodar o agendamento em segundo plano."""
    while True:
        schedule.run_pending()
        time.sleep(1)

if __name__ == '__main__':
    setup_database()
    
    # Agendar as tarefas
    schedule.every(10).minutes.do(fetch_and_store_data)
    schedule.every().day.at("23:59").do(delete_data_at_eod)

    # Iniciar o agendador em uma nova thread para não bloquear o servidor Flask
    scheduler_thread = threading.Thread(target=run_scheduler)
    scheduler_thread.daemon = True
    scheduler_thread.start()

    # Iniciar o servidor Flask
    app.run(debug=True)
