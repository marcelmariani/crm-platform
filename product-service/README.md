# Product Service

Microservice responsible for managing products in the CRM ecosystem.

## Features

- Create and list products
- Product fields:
  - `codigo` (string, required, unique)
  - `descricao` (string, required)
  - `percentualComissao` (number, required)
  - `valorLimiteComissao` (number, required)
  - `status` (string: 'created' | 'active' | 'inactive', default: 'created')

## Tech Stack

- Node.js (ESM)
- Express.js
- MongoDB (Mongoose)
- JWT Authentication
- Winston Logger
- HTTPS with local certificate

## Endpoints

### POST /v1/products

Create a new product.

#### Body
```json
{
  "codigo": "P123",
  "descricao": "Produto Exemplo",
  "percentualComissao": 10,
  "valorLimiteComissao": 200.0
}
```

### GET /v1/products

List all products.

## Environment Variables

Set per environment (`.env.development`, `.env.test`, `.env.production`):

- `PORT`, `MONGO_URI`, `MONGO_DATABASE`
- `JWT_SECRET`, `SSL_KEY_PATH`, `SSL_CERT_PATH`
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASS`, etc.

## Scripts

```bash
npm run dev        # Development with nodemon
npm start          # Production start
```

## License

MIT
