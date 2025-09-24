Com certeza\! Abaixo, apresento uma documentação técnica detalhada do seu código, explicando o funcionamento de cada parte, as implementações e as requisições, tanto do lado do servidor (`server.js`) quanto do lado do cliente (`public/app.js`).

# Documentação Técnica Detalhada – Dash-Movidesk

Este documento oferece uma análise aprofundada de cada componente do projeto Dash-Movidesk, descrevendo a arquitetura, o fluxo de dados e as funcionalidades implementadas.

-----

## **`server.js` - O Coração do Back-end**

O arquivo `server.js` é o ponto de entrada da aplicação e concentra toda a lógica do lado do servidor. Ele é responsável por gerenciar as requisições, a autenticação de usuários, a comunicação com o banco de dados e a integração com a API do Movidesk.

### **1. Importação de Módulos**

O código inicia importando todas as dependências necessárias para o funcionamento do servidor:

```javascript
import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import session from "express-session";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";
import path from "path";
import { fileURLToPath } from "url";
import dns from "node:dns";
```

  - **`express`**: Framework principal para a construção do servidor e gerenciamento de rotas.
  - **`axios`**: Cliente HTTP para realizar requisições à API do Movidesk.
  - **`dotenv`**: Carrega variáveis de ambiente de um arquivo `.env`, mantendo dados sensíveis (como senhas e tokens) fora do código-fonte.
  - **`express-session`**: Middleware para gerenciamento de sessões de usuários, essencial para o sistema de login.
  - **`bcryptjs`**: Biblioteca para criptografar e comparar senhas de forma segura.
  - **`mysql2/promise`**: Driver de banco de dados MySQL com suporte a Promises, para uma comunicação assíncrona com o banco de dados.
  - **`path`**, **`fileURLToPath`**, **`dns`**: Módulos nativos do Node.js para manipulação de caminhos de arquivos e configurações de DNS.

### **2. Configuração do Banco de Dados**

A conexão com o banco de dados é estabelecida utilizando as credenciais do arquivo `.env`. O código também garante que as tabelas necessárias para o funcionamento da aplicação existam, criando-as se não for o caso:

  - **`user_card_colors`**: Armazena as cores personalizadas dos cards de tickets para cada usuário.
  - **`melhorias`**: Guarda sugestões de melhorias enviadas pelos usuários.
  - **`user_ticket_orders`**: Salva a ordem personalizada dos tickets nas colunas do Kanban.
  - **`service_custom_fields`**: Mapeia serviços a campos customizados específicos.

### **3. Configuração do Servidor e Middlewares**

O servidor Express é inicializado e configurado com middlewares essenciais:

  - **`express-session`**: Configura o gerenciamento de sessões, utilizando um "segredo" para assinar o cookie da sessão.
  - **`express.json()`** e **`express.urlencoded()`**: Permitem que o servidor interprete o corpo de requisições nos formatos JSON e URL-encoded, respectivamente.
  - **`express.static("public")`**: Serve os arquivos estáticos (HTML, CSS, JavaScript do cliente) da pasta `public`.

### **4. Rotas e Endpoints da API**

Esta é a seção principal do `server.js`, onde cada rota da aplicação é definida.

#### **Autenticação e Páginas**

  - **`GET /`**: Rota raiz. Redireciona para o dashboard se o usuário estiver logado; caso contrário, exibe a página de login (`login.html`).
  - **`POST /login`**: Processa o login. Recebe `username` e `password`, compara a senha com o hash armazenado no banco de dados e, se for válida, cria uma sessão para o usuário.
  - **`GET /dashboard`**: Exibe a página principal do dashboard (`index.html`) se o usuário estiver autenticado.
  - **`GET /logout`**: Destrói a sessão do usuário e o redireciona para a página de login.

#### **API de Tickets (Kanban)**

  - **`GET /api/tickets`**: Endpoint principal do dashboard.
      - **Autenticação**: Requer que o usuário esteja logado.
      - **Lógica**:
        1.  Busca os tickets ativos (`New`, `InAttendance`, `Stopped`) na API do Movidesk, filtrando pela equipe do usuário logado (`req.session.team`).
        2.  Calcula informações adicionais para cada ticket, como a previsão de solução (`previsaoSolucao`) e se está vencido (`overdue`).
        3.  Agrega os dados, contando o total de tickets por status, urgência e responsável.
        4.  Se a API do Movidesk estiver indisponível, retorna um conjunto de dados "mock" para que o front-end não quebre.
      - **Retorno**: Um objeto JSON contendo as contagens e a lista de tickets para renderização no Kanban.

#### **API de Relatórios**

  - **`GET /api/service-tickets`**: Utilizada na página de relatórios.
      - **Autenticação**: Requer que o usuário esteja logado (`requireAuth`).
      - **Lógica**:
        1.  Recebe parâmetros de consulta (query params) como `service`, `start`, `end` e `status` para filtrar os tickets.
        2.  Monta uma query OData para a API do Movidesk, escapando caracteres especiais para evitar erros.
        3.  Busca os tickets e, para cada um, extrai informações relevantes como `owner`, `solvedDate`, e o valor de campos personalizados.
      - **Retorno**: Um objeto JSON com os tickets filtrados e contagens relacionadas.

#### **APIs de Preferências do Usuário**

  - **`GET /api/card-colors`** e **`POST /api/card-colors`**: Permitem, respectivamente, buscar e salvar as cores personalizadas dos cards de tickets para o usuário logado.
  - **`GET /api/ticket-order`** e **`POST /api/ticket-order`**: Rotas para buscar e salvar a ordenação manual dos tickets nas colunas do Kanban.

#### **Rotas de Administração**

  - **`GET /admin/users`**: Retorna todos os usuários cadastrados. Protegida pelo middleware `requireAdmin`.
  - **`/api/custom-fields`**: Endpoints `GET`, `POST` e `DELETE` para gerenciar o mapeamento de campos personalizados. Também protegidos por `requireAdmin`.

### **5. Middlewares de Permissão**

  - **`requireAuth(req, res, next)`**: Verifica se `req.session.userId` existe. Se não, retorna um erro 401 (Não Autorizado), impedindo o acesso a rotas protegidas.
  - **`requireAdmin(req, res, next)`**: Garante que apenas usuários com a role `admin` possam acessar a rota.
  - **`requireSupervisor(req, res, next)`**: Permite o acesso a usuários com as roles `admin` ou `supervisor`.

-----

## **`public/app.js` - A Lógica do Front-end**

Este arquivo é responsável por toda a interatividade do dashboard, desde a busca de dados até a renderização dos elementos na tela.

### **1. Estrutura Principal e Variáveis Globais**

O código é encapsulado em uma IIFE (Immediately Invoked Function Expression) para evitar a poluição do escopo global. São definidas variáveis para armazenar o estado da aplicação:

  - **`urgencyColors`, `agentPalette`**: Paletas de cores para os gráficos e elementos da interface.
  - **`userCardColors`**: Objeto que armazena as cores personalizadas dos cards.
  - **`userTicketOrder`**: Guarda a ordem dos tickets definida pelo usuário.
  - **`colData`**: Objeto que armazena os arrays de tickets para cada coluna do Kanban (`novos`, `atendimento`, etc.).

### **2. `carregarDashboard()` - A Função Central**

É a função principal que orquestra a busca e a renderização dos dados no dashboard.

  - **Fluxo de Execução**:
    1.  **Busca de Dados**: Utiliza `Promise.all` para fazer requisições simultâneas aos endpoints `/api/tickets`, `/api/card-colors` e `/api/ticket-order`.
    2.  **Processamento dos Tickets**:
          - Os dados recebidos de `/api/tickets` são processados e distribuídos nas colunas (`colData`) de acordo com seu status (`New`, `InAttendance`, `Stopped`) ou se estão vencidos (`overdue`).
          - Tickets fechados, resolvidos ou cancelados são ignorados.
    3.  **Renderização**: Chama as funções responsáveis por renderizar cada componente da tela:
          - `renderColumns()`: Para exibir os tickets no Kanban.
          - `renderDonut()`: Para o gráfico de prioridades.
          - `renderDonutAgents()`: Para o gráfico de agentes.
          - `renderAgentFilterDropdown()`: Para popular o filtro de agentes.
  - **Atualização Automática**: `setInterval(carregarDashboard, 300000)` recarrega os dados a cada 5 minutos, mantendo o dashboard atualizado.

### **3. Renderização e Manipulação do DOM**

#### **Cards de Tickets**

  - **`buildTicketCard(t)`**: Função que cria dinamicamente o HTML de um card de ticket com base nos dados recebidos.
      - Define classes CSS para estilização com base na urgência e status.
      - Adiciona listeners de evento para expandir/recolher o card.
      - Inclui botões para alterar e resetar a cor do card, com a lógica de persistência (`persistCardColor`).
  - **`renderColumns()`**: Itera sobre os dados em `colData` e chama `buildTicketCard` para cada ticket, inserindo os cards nas colunas correspondentes no HTML.

#### **Gráficos (Chart.js)**

  - **`renderDonut(prioridades)`** e **`renderDonutAgents(mapa)`**: Funções que utilizam a biblioteca `Chart.js` para criar os gráficos de pizza. Elas recebem os dados agregados do back-end e configuram os gráficos, destruindo a instância anterior antes de renderizar uma nova para garantir que os dados estejam sempre atualizados.

### **4. Interatividade do Usuário**

  - **Filtro por Agente**: A função `renderAgentFilterDropdown` popula o `<select>` com os nomes dos agentes. Um listener de evento no dropdown (não mostrado explicitamente, mas implícito no HTML) acionaria uma nova carga de dados com o filtro aplicado.
  - **Personalização de Cores**: A função `persistCardColor` é chamada quando o usuário altera a cor de um card. Ela envia uma requisição `POST` para `/api/card-colors` para salvar a preferência no banco de dados.
  - **Arrastar e Soltar (Drag and Drop)**:
      - `registerCardDragEvents()`: Adiciona os listeners de evento `dragstart` e `dragend` a cada card.
      - `ensureListDnDHandlers()`: Adiciona os listeners `dragover`, `dragleave` e `drop` às colunas.
      - Quando um card é solto, a lógica calcula a nova posição, atualiza o array `userTicketOrder` e chama `persistTicketOrder` para salvar a nova ordem no servidor.

### **5. Helpers - Funções Utilitárias**

O arquivo `app.js` também contém várias funções de ajuda para normalizar texto, formatar datas e manipular cores, o que mantém o código mais limpo e organizado.
