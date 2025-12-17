# auth-service

Microserviço de autenticação via JWT com gerenciamento de usuários, hierarquia de grupos e controle de recursos.

## 📚 Documentação

- **[Guia de Deploy AWS Lambda](docs/deployment/DEPLOY-AWS.md)** - Deploy automatizado via GitHub Actions
- **[Configuração AWS SSM](docs/deployment/AWS-SSM-CONFIG.md)** - Gerenciamento de variáveis no Parameter Store
- **[Setup AWS](docs/deployment/SETUP-AWS.md)** - Configuração inicial da infraestrutura AWS
- **[AWS Lambda Summary](docs/deployment/AWS-LAMBDA-SUMMARY.md)** - Resumo da arquitetura serverless

## 🚀 Quick Start

### Desenvolvimento Local

```bash
# 1. Clone o repositório
git clone https://github.com/SmartIA-Systems/auth-service.git
cd auth-service

# 2. Instale dependências
npm install

# 3. Configure variáveis de ambiente
cp .env.example .env.development

# 4. Inicie com Docker
docker-compose up -d

# 5. Execute em modo desenvolvimento
npm run dev
```

### Deploy em Produção (AWS Lambda)

Consulte o [Guia de Deploy AWS](docs/deployment/DEPLOY-AWS.md) para instruções completas.

## Principais Funcionalidades

- **JWT Authentication**: Emissão e validação de tokens para acesso a rotas protegidas.
- **Gerenciamento de Usuários**: CRUD de usuários, senhas seguras, status ativo/inativo.
- **Hierarquia de Grupos**: Estrutura de grupos (incluindo o grupo `admin`) com herança de permissões.
- **Controle de Recursos**: Associação de recursos a grupos para autorização granular.
- **Bootstrap Automático**:
  - Criação idempotente de:
    - Grupo **admin** e usuário **admin** (senha via `JWT_ADMIN_PASS`).
    - Recursos padrão: `bank`, `bank-correspondent`, `real-estate`, `agent`.
    - Grupos adicionais em **development** e **staging**:
      - `group-bank-correspondent` (sem recursos).
      - `group-real-estate` (recursos: `real-estate`, `agent`).
      - `group-agent` (recurso: `agent`).
    - Usuários de teste em **development** e **staging**:
      - `bank-correspondent`, `real-estate`, `agent` (senha: `Smart@123`).
- **Ambientes Seguros**: HTTPS local em `development`/`staging`, HTTP em `production`.

## Configuração de Ambiente

Copie e adapte o `.env.example` para cada ambiente:

```
PORT=
MONGO_URI=
JWT_SECRET=
JWT_ADMIN_PASS=
JWT_EXPIRES_IN=
LOG_LEVEL=
SSL_KEY_PATH=
SSL_CERT_PATH=
```

### Arquivos de exemplo

- `.env.development`
- `.env.staging`
- `.env.test`
- `.env.production`

## Docker

- **Dockerfile**: Empacota a aplicação Node.js ESM.
- **docker-compose.yml**: Orquestra `auth-service` e `mongo`.

## Scripts NPM

- `npm run dev` — Inicia em modo desenvolvimento (HTTPS local).
- `npm start` — Inicia em modo produção (HTTP).
- `npm test` — Executa testes com Vitest.
- `npm run test:report` — Testes com geração de relatório.

## Bootstrap de Autenticação via Models

O script `src/utils/auth-bootstrap.js` realiza o _seed_ das coleções diretamente via models do Mongoose, sem expor endpoints HTTP.

Exemplo de execução:

```bash
MONGODB_URI="mongodb://root:root@localhost:27017" MONGO_DATABASE="develop-auth-service" JWT_ADMIN_PASS="<senha-admin>" SEED_MODE=no_production NODE_ENV=development node src/utils/auth-bootstrap.js
```

**Variáveis obrigatórias**

- `MONGODB_URI` – URI do MongoDB **sem** nome da base.
- `MONGO_DATABASE` – Nome da base de dados a ser utilizada.
- `JWT_ADMIN_PASS` – Senha inicial do usuário `admin`.
- `SEED_MODE` – `production` ou `no_production`.
- `NODE_ENV` – Ambiente (`development` ou `production`).

**Variáveis opcionais**

- `SEED_ADMIN_PASSWORD_PROD` (padrão: `JWT_ADMIN_PASS`)
- `SEED_DEFAULT_PASSWORD_PROD` (padrão: `JWT_ADMIN_PASS`)
- `SEED_DEFAULT_PASSWORD_DEV` (padrão: `JWT_ADMIN_PASS`)
- `SEED_FORCE_RESET_PASSWORD` (padrão: `'false'`)

## Estrutura de Pastas

```
src/
├─ config/          # Database, logger, vars de ambiente
├─ models/          # Mongoose schemas (User, Group, Resource)
├─ services/        # Lógica de domínio (Auth, Group, Resource)
├─ controllers/     # Pontos de entrada das rotas
├─ routes/          # Definição de endpoints
├─ middlewares/     # Autorização JWT e por grupo admin
└─ utils/
   ├─ auth-bootstrap.js       # Seed via models (sem HTTP)
   └─ dev-domain-bootstrap.js # Seed de dados de domínio em desenvolvimento

index.js            # Inicialização do servidor e bootstrap
tests/              # Testes Vitest

Dockerfile
docker-compose.yml
.eslint.config.js
README.md
```

## Endpoints

### Autenticação

- **POST** `/v1/auth/register`  
  Registra um novo usuário (somente admin):
  ```json
  {
    "userName": "<email>",
    "password": "<senha>",
    "groupId": "<groupId>"
  }
  ```

- **POST** `/v1/auth/login`  
  Emite JWT:
  ```json
  {
    "userName": "<email>",
    "password": "<senha>"
  }
  ```

- **GET** `/v1/protected`  
  Rota de exemplo protegida.  
  Header: `Authorization: Bearer <token>`

### Usuários

- **GET** `/v1/auth/users`  
  Lista usuários.  
  Query opcional: `?status=active&group=<groupId>`  
  Header: `Authorization: Bearer <token>`

### Grupos

- **POST** `/v1/groups`  
  Cria novo grupo (somente admin para criar o `admin`).  
- **GET** `/v1/groups`  
  Lista grupos.  
- **GET** `/v1/groups/:id`  
  Detalha grupo.  
- **PUT** `/v1/groups/:id`  
  Atualiza grupo.  
- **DELETE** `/v1/groups/:id`  
  Remove grupo.

### Recursos

- **POST** `/v1/resources`  
  Cria recurso (somente admin).  
- **GET** `/v1/resources`  
  Lista recursos.  
- **GET** `/v1/resources/:id`  
  Detalha recurso.  
- **PUT** `/v1/resources/:id`  
  Atualiza recurso (status ativo/inativo).  
- **DELETE** `/v1/resources/:id`  
  Soft-delete via `status: 'inactive'`.

## Suporte e Contribuição

1. Clone o repositório.  
2. Configure `.env`.  
3. Instale dependências: `npm install`.  
4. Execute em dev: `npm run dev`.  
5. Importe a coleção Postman em `postman/collection.json`.

---

© 2025 SmartIASystems
