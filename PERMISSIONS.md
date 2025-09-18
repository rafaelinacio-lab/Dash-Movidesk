# Sistema de Permissões

Este documento descreve o sistema de permissões personalizado.

## Visão Geral

O sistema de permissões é baseado em papéis (roles). Cada usuário tem um papel associado a ele, e cada papel tem um conjunto de permissões. As permissões são verificadas em middlewares antes de permitir o acesso a rotas específicas.

## Papéis (Roles)

Existem três papéis definidos no sistema:

-   `admin`: Acesso total a todas as funcionalidades, incluindo o painel de administração.
-   `supervisor`: Acesso ao dashboard e aos relatórios. Não tem acesso ao painel de administração.
-   `user`: Acesso apenas ao dashboard.

## Como Funciona

1.  **Login**: Quando um usuário faz login, seu papel (`role`) é armazenado na sessão.
2.  **Middlewares**: As rotas são protegidas por middlewares que verificam o papel do usuário.
3.  **Verificação de Permissão**: O middleware verifica se o papel do usuário tem permissão para acessar a rota solicitada.

## Onde dar Manutenção

Toda a lógica de permissão está centralizada em `server.js`.

### 1. Definição de Papéis e Permissões

Os papéis são definidos na tabela `users` do banco de dados. Você pode adicionar novos papéis ou modificar os existentes diretamente no banco de dados.

As permissões para cada papel são definidas nos middlewares em `server.js`.

### 2. Middlewares de Autorização

Os middlewares de autorização são funções que verificam se um usuário tem permissão para acessar uma rota.

Existem dois middlewares principais em `server.js`:

-   `requireAuth`: Verifica se o usuário está autenticado.
-   `requireAdmin`: Verifica se o usuário tem o papel de `admin`.

Para o papel de `supervisor`, criaremos um novo middleware chamado `requireSupervisor`.

### 3. Protegendo Rotas

Para proteger uma rota, você adiciona o middleware de autorização apropriado à definição da rota.

**Exemplo:**

```javascript
// Rota acessível apenas por admins
app.get('/admin/dashboard', requireAdmin, (req, res) => {
  // ...
});

// Rota acessível por admins e supervisores
app.get('/reports', requireSupervisor, (req, res) => {
  // ...
});
```

## O que cada um tem acesso

-   **Admin**:
    -   Dashboard (`/dashboard`)
    -   Painel de Administração (`/admin/*`)
    -   Relatórios (`/reports`)
    -   Todas as rotas da API (`/api/*`)

-   **Supervisor**:
    -   Dashboard (`/dashboard`)
    -   Relatórios (`/reports`)
    -   Rotas da API necessárias para o dashboard e relatórios.

-   **User**:
    -   Dashboard (`/dashboard`)
    -   Rotas da API necessárias para o dashboard.
