Com certeza\! Baseado nos arquivos que você enviou, aqui está uma documentação completa e bem estruturada para o seu projeto Dash-Movidesk, pronta para ser usada no GitHub.

# Documentação do Projeto Dash-Movidesk

## Visão Geral do Projeto

O Dash-Movidesk é um painel de controle interativo projetado para visualizar e gerenciar tickets do Movidesk. A aplicação oferece uma interface Kanban que permite aos usuários acompanhar o status dos tickets, além de fornecer funcionalidades administrativas e de relatórios para diferentes níveis de acesso. O sistema é construído com Node.js e Express para o back-end, e utiliza HTML, CSS e JavaScript no front-end para uma experiência de usuário dinâmica e responsiva.

## Funcionalidades Principais

  * **Dashboard Kanban de Tickets**: Visualização de tickets em colunas como "Novo", "Em Atendimento", "Aguardando" e "Vencidos".
  * **Busca de Tickets**: Ferramenta de busca para localizar tickets por ID.
  * **Permissões de Usuário**: Sistema de acesso baseado em papéis (`admin`, `supervisor`, `user`).
  * **Painel de Administração**: Interface para administradores gerenciarem usuários e configurações do sistema.
  * **Página de Relatórios**: Seção para visualização de relatórios, com acesso restrito a administradores e supervisores.
  * **Tema Claro/Escuro**: Opção de alternância entre os temas claro e escuro para melhor visualização.

## Estrutura de Arquivos

Aqui está a estrutura dos principais arquivos do projeto:

  * **`server.js`**: O arquivo principal do back-end, responsável por configurar o servidor Express, gerenciar rotas, e estabelecer a conexão com o banco de dados.
  * **`package.json`**: Define os metadados do projeto e suas dependências, como `axios`, `express` e `mysql2`.
  * **`public/`**: Contém os arquivos do front-end:
      * **`index.html`**: A página principal do dashboard.
      * **`app.js`**: Lógica do front-end, incluindo a renderização dos tickets, gráficos e interações do usuário.
      * **`style.css`**: Estilos da aplicação.
      * **`login.html`**: Página de login.
  * **`DOCUMENTATION.md`**: Documentação geral do projeto.
  * **`PERMISSIONS.md`**: Detalhes sobre o sistema de permissões.

## Back-end (`server.js`)

O `server.js` é o coração da aplicação, responsável por:

  * **Configuração do Servidor**: Inicializa um servidor Express e define a porta de operação.
  * **Conexão com o Banco de Dados**: Estabelece conexão com um banco de dados MySQL (`mysql2`) para armazenar informações sobre usuários e preferências.
  * **Gerenciamento de Sessão**: Utiliza `express-session` para gerenciar as sessões dos usuários após o login.
  * **Rotas da API**:
      * `/login`: Autentica os usuários.
      * `/api/tickets`: Retorna os dados dos tickets para o dashboard.
      * `/api/service-tickets`: Busca tickets com base em serviços específicos.
      * `/admin/users`: (Apenas para `admin`) Retorna a lista de usuários.
  * **Middlewares de Autenticação**:
      * `requireAuth`: Garante que o usuário esteja autenticado.
      * `requireAdmin`: Restringe o acesso a rotas apenas para administradores.
      * `requireSupervisor`: Permite acesso a administradores e supervisores.

## Front-end (`public/app.js`)

O `app.js` gerencia a interface do usuário, incluindo:

  * **Carregamento de Dados**: Realiza chamadas para a API back-end para buscar os dados dos tickets e renderizá-los no dashboard.
  * **Renderização Dinâmica**:
      * **Dashboard**: Popula as colunas do Kanban com os tickets correspondentes.
      * **Gráficos**: Utiliza a biblioteca Chart.js para criar gráficos de pizza que mostram a distribuição de tickets por prioridade e por agente.
  * **Interatividade**:
      * **Filtro por Agente**: Permite filtrar os tickets exibidos no dashboard por agente.
      * **Cores de Card**: Os usuários podem personalizar as cores dos cards de tickets.
      * **Paginação**: Carrega mais tickets em cada coluna conforme o usuário rola a página.
      * **Arrastar e Soltar**: Funcionalidade para reordenar os tickets dentro das colunas.

## Sistema de Permissões

O controle de acesso é dividido em três papéis principais:

  * **`admin`**: Acesso total, incluindo o painel de administração para gerenciamento de usuários.
  * **`supervisor`**: Pode visualizar o dashboard e a página de relatórios.
  * **`user`**: Acesso limitado ao dashboard principal.

Toda a lógica de permissões é gerenciada no `server.js` através de middlewares que verificam o `role` do usuário armazenado na sessão.

## Como Iniciar

1.  **Instale as dependências**:
    ```bash
    npm install
    ```
2.  **Configure as variáveis de ambiente**: Crie um arquivo `.env` na raiz do projeto e adicione as seguintes variáveis:
    ```
    PORT=3000
    DB_HOST=localhost
    DB_USER=root
    DB_PASS=secret
    DB_NAME=si_panel
    MOVI_TOKEN=seu_token_aqui
    SESSION_SECRET=seu_segredo_de_sessao
    ```
3.  **Inicie o servidor**:
    ```bash
    npm start
    ```
4.  Acesse `http://localhost:3000` no seu navegador.
