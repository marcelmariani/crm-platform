# real-estate-service — README

## Visão Geral
Serviço responsável pelo **cadastro de Imobiliárias**.  
Suporta múltiplos correspondentes via `bankCorrespondentIds: ObjectId[]`.

## Stack
- Node.js (ESM), Express + HTTPS, JWT, Mongoose (`versionKey: false`), Vitest, Postman 11.50.1

## Regras de Acesso
- **admin**: pode tudo.
- **real-estate (owner)**: vê/atua no próprio registro (`ownerAuthId = sub`).
- **Cascata recebida de bank-correspondent**:
  - Dono de um bank-correspondent tem escopo sobre real-estates que o incluam em `bankCorrespondentIds`.
- Autorização recursiva por recurso (grupos/ancestrais) com `authorizeResource()`  
  (`APP_RESOURCE_NAME=real-estate-service`).

## Escopo (middleware)
- Admin: sem filtro.
- Não-admin:
  - tenta obter `bankCorrespondentId` no serviço pai (`/v1/bank-correspondents/by-owner/:sub`);
  - **filtro padrão**: `ownerAuthId = sub` **OU** `bankCorrespondentIds = bankCorrespondentId`;
  - se não houver correspondente, cai em **ownership puro** (`ownerAuthId = sub`).
- O middleware escreve em `req.scope`: `{ bankCorrespondentId, realEstateIds }`.

## Modelo (resumo)
- `ownerAuthId: ObjectId` (obrigatório)
- `bankCorrespondentIds: ObjectId[]` (vínculo com correspondentes) ✅ **array**
- `name: string`
- timestamps, `versionKey: false`

## Variáveis de Ambiente
```env
NODE_ENV=development
PORT=3003
JWT_SERVICE_URL=https://localhost:3000
JWT_LOGIN_PATH=/auth/login
JWT_ADMIN_USERNAME=admin
JWT_ADMIN_PASS=<segredo>
APP_RESOURCE_NAME=real-estate-service
BC_SERVICE_URL=https://localhost:3003
MONGODB_URI=mongodb://localhost:27017/develop-real-estate-service
```

## Ordem dos Middlewares
```
authorizeAccessUser
authorizeResource()               # APP_RESOURCE_NAME=real-estate-service
buildRecursiveScopeRealEstate()   # define req.scope
```

## Endpoints
```
POST   /v1/real-estates
GET    /v1/real-estates
GET    /v1/real-estates/ids         # retorna somente IDs (usado pelo agent-service)
GET    /v1/real-estates/:id
PUT    /v1/real-estates/:id
DELETE /v1/real-estates/:id
```

### Notas de Autorização por endpoint
- Admin: total acesso.
- Não-admin: filtros aplicam `ownerAuthId = sub` **OU** `bankCorrespondentIds` contem o correspondente do usuário.
- `/ids`: valida que a query pertence ao escopo do chamador.

## Fluxo de Teste (curl)
```bash
# login
TOKEN=$(curl -sS https://localhost:3000/v1/auth/login   -H "Content-Type: application/json"   --data '{"userName":"bank-correspondent","password":"password_admin_no_production"}' | jq -r .token)

# criar RE (não-admin): owner=sub e garante vínculos
curl -sS https://localhost:3003/v1/real-estates   -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json"   --data '{"name":"Imobiliária XPTO","bankCorrespondentIds":["<bcId>"]}'
```

## Testes
```bash
pnpm vitest
# ou
npm run test
```
