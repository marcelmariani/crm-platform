# Bank Service

## Descrição

Microserviço CRUD para cadastro de bancos no projeto bank-branch-system.

## Histórico de Versões

- v1.0.0 (2025-07-27): Implementação inicial do CRUD de bancos.
- v1.1.0 (2025-07-27): Implementação dos endpoints GET by ID, PUT e DELETE.

## Tecnologias

- Node.js (ESM)
- Express.js
- HTTPS com certificado SSL
- JWT Authentication
- MongoDB (Mongoose, versionKey desativado)
- Winston (Logging)
- Vitest (Cobertura >90%)
- Postman 11.50.1

## Instalação

1. Instale as dependências:  
   ```bash
   npm install express mongoose jsonwebtoken winston vitest cors dotenv
   ```

2. Configure variáveis de ambiente em `.env.development`, `.env.test` e `.env.production`:  
   - `PORT`
   - `MONGO_URI`
   - `JWT_SECRET`
   - `SSL_KEY_PATH`
   - `SSL_CERT_PATH`

**Não incluir**: .env, package.json, .gitignore, CHANGELOG.md.

## API Endpoints

| Method | Route             | Description             |
|--------|-------------------|-------------------------|
| POST   | /v1/banks         | Create a new bank       |
| GET    | /v1/banks         | List all banks          |
| GET    | /v1/banks/:id     | Get a bank by ID        |
| PUT    | /v1/banks/:id     | Update a bank by ID     |
| DELETE | /v1/banks/:id     | Delete a bank by ID     |

## Execução

```bash
npm start
```

## Testes

```bash
npm test
```

## Collection Postman

Importe `postman_collection.json` no Postman 11.50.1.

## Estrutura de Pastas

```
src/
  config/
    config.js
    database.js
    logger.js
  middlewares/
    auth.js
  models/
    Bank.js
  controllers/
    bankController.js
  routes/
    bankRoutes.js
  index.js
tests/
  bankController.test.js
vitest.config.js
README.md
postman_collection.json
```