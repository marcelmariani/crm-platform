# agent-service — README

## Visão Geral
Serviço responsável pelo **cadastro de Corretores**.  
Suporta múltiplas imobiliárias via `realEstateIds: ObjectId[]`.

## Stack
- Node.js (ESM), Express + HTTPS, JWT, Mongoose (`versionKey: false`), Vitest, Postman 11.50.1

## Regras de Acesso
- **admin**: pode tudo.
- **agent (owner)**: vê/atua **apenas** no próprio registro (`ownerAuthId = sub`).
- **Cascata recebida de real-estate**:
  - Dono de um real-estate tem escopo sobre agents que contenham esse real-estate em `realEstateIds`.
  - Dono de um bank-correspondent (via real-estate do escopo) também alcança agents vinculados a esses REs.
- Autorização recursiva por recurso com `authorizeResource()`  
  (`APP_RESOURCE_NAME=agent-service`).

## Escopo (middleware)
- Admin: sem filtro.
- Não-admin:
  - chama `real-estate-service` em `/v1/real-estates/ids?ownerAuthId=<sub>` (o RE-service já valida o escopo por correspondente se existir);
  - escopo de agentes: `ownerAuthId = sub` **OU** `realEstateIds ∈ <IDs permitidos>`.
- O middleware escreve em `req.scope`: `{ realEstateIds, agentIds }`.

## Modelo (resumo)
- `ownerAuthId: ObjectId` (obrigatório)
- `realEstateIds: ObjectId[]` ✅ **array**
- `name: string`
- timestamps, `versionKey: false`

## Variáveis de Ambiente
```env
NODE_ENV=development
PORT=3004
JWT_SERVICE_URL=https://localhost:3000
JWT_LOGIN_PATH=/auth/login
JWT_ADMIN_USERNAME=admin
JWT_ADMIN_PASS=<segredo>
APP_RESOURCE_NAME=agent-service
APP_REAL_ESTATE_SERVICE_URL=https://localhost:3003
MONGODB_URI=mongodb://localhost:27017/develop-agent-service
```

## Ordem dos Middlewares
```
authorizeAccessUser
authorizeResource()            # APP_RESOURCE_NAME=agent-service
buildRecursiveScopeAgent()     # usa /real-estates/ids para montar req.scope
```

## Endpoints
```
POST   /v1/agents
GET    /v1/agents
GET    /v1/agents/:id
PUT    /v1/agents/:id
DELETE /v1/agents/:id
```

### Notas de Autorização por endpoint
- Admin: total acesso.
- Não-admin: filtros aplicam `ownerAuthId = sub` **OU** `realEstateIds: { $in: req.scope.realEstateIds }`.
- `POST`: payload deve conter ao menos **um** `realEstateId` dentro do escopo permitido; caso contrário 403.

## Fluxo de Teste (curl)
```bash
# login
TOKEN=$(curl -sS https://localhost:3000/v1/auth/login   -H "Content-Type: application/json"   --data '{"userName":"real-estate","password":"password_admin_no_production"}' | jq -r .token)

# criar Agent (não-admin) exigindo RE do escopo
curl -sS https://localhost:3004/v1/agents   -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json"   --data '{"name":"Corretor A","realEstateIds":["<realEstateIdPermitido>"]}'
```

## Testes
```bash
pnpm vitest
# ou
npm run test
```
