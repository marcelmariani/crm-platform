# bank-correspondent-service — README

## Visão Geral
Serviço responsável pelo **cadastro de Correspondente Bancário**.  
Modelo de autorização: **JWT + Grupos/Recursos (Auth)**, com **ownership** (`ownerAuthId`) e **cascata de acesso** para serviços filhos.

## Stack
- Node.js (ESM)
- Express + HTTPS
- JWT (via Auth-Service)
- Mongoose (`versionKey: false`)
- Vitest
- (Opcional) Venom-bot
- Postman 11.50.1 (coleções/exemplos)

## Regras de Acesso
- **admin**: pode tudo.
- **bank-correspondent (owner)**: vê/atua **apenas** no próprio registro (`ownerAuthId = sub`).
- **Efeito para filhos**:
  - Usuário dono de um bank-correspondent terá escopo sobre:
    - **real-estate** que o contenham em `bankCorrespondentIds`;
    - **agent** vinculados a esses real-estate.

Autorização de recurso é recursiva por grupo/ancestrais via middleware `authorizeGroupResource(APP_RESOURCE_NAME, PERM.READ)`  
(`APP_RESOURCE_NAME=bank-correspondent-service`).

## Modelo (resumo)
- `ownerAuthId: ObjectId` (obrigatório)
- `name: string`
- `code: string` (único)
- `bankId: ObjectId`
- timestamps, `versionKey: false`

## Variáveis de Ambiente
```env
NODE_ENV=development
PORT=3002
JWT_SERVICE_URL=https://localhost:3000
JWT_LOGIN_PATH=/auth/login
JWT_ADMIN_USERNAME=admin
JWT_SECRET=<segredo>
APP_RESOURCE_NAME=bank-correspondent-service
MONGO_URI=mongodb://localhost:27017/develop-bank-correspondent-service
MONGODB_URI=mongodb://localhost:27017/develop-bank-correspondent-service
MONGO_DATABASE=develop-bank-correspondent-service
```

`MONGO_URI` tem precedência sobre `MONGODB_URI`. Se ambos estiverem definidos, o serviço usará o valor de `MONGO_URI`.

> Em dev, o middleware usa `https.Agent({ rejectUnauthorized: false })`. Em prod, use certificados válidos.

## Ordem dos Middlewares
```
authorizeAccessUser  -> popula req.user (sub, group)
authorizeGroupResource(APP_RESOURCE_NAME, PERM.READ) -> valida acesso ao recurso e expõe req.grant
```
### Exemplo de uso nas rotas

```js
import { Router } from 'express';
import { authorizeAccessUser } from './middlewares/authorizeAccessUser.js';
import { authorizeGroupResource, PERM } from './middlewares/authorizeGroupResource.js';

const router = Router();

router.get(
  '/v1/bank-correspondents',
  authorizeAccessUser,
  authorizeGroupResource(process.env.APP_RESOURCE_NAME, PERM.READ),
  controller.list
);
```


## Endpoints
```
POST   /v1/bank-correspondents
GET    /v1/bank-correspondents
GET    /v1/bank-correspondents/:id
PUT    /v1/bank-correspondents/:id
DELETE /v1/bank-correspondents/:id

# util p/ serviços filhos (descobrir correspondente do usuário)
GET    /v1/bank-correspondents/by-owner/:authId
```

### Notas de Autorização por endpoint
- `POST/GET (lista)/PUT/DELETE`: admin **ou** owner do doc (ownership).
- `GET :id`: admin **ou** owner do doc.
- `GET by-owner/:authId`: admin pode consultar qualquer `authId`; não-admin apenas o próprio.

## Fluxo de Teste (curl)
1) Login no Auth:
```bash
curl -sS https://localhost:3000/v1/auth/login   -H "Content-Type: application/json"   --data '{"userName":"bank-correspondent","password":"password_admin_no_production"}'
```
2) Criar correspondente:
```bash
curl -sS https://localhost:3002/v1/bank-correspondents   -H "Authorization: Bearer <TOKEN>"   -H "Content-Type: application/json"   --data '{"name":"CCA","code":"CCA-0001","bankId":"<bankId>"}'
```

## Testes
```bash
pnpm vitest
# ou
npm run test
```

Para encerrar a conexão com o banco após os testes (incluindo o
`MongoMemoryServer` usado como fallback), utilize a função
`closeDatabase`:

```js
import { afterAll } from 'vitest';
import { closeDatabase } from './src/config/database.js';

afterAll(async () => {
  await closeDatabase();
});
```

## Venom-bot (opcional)
Se usado (ex.: notificações WhatsApp), documente as envs e inicialização do Venom separadamente.
