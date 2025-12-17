import request from 'supertest';
import { jest } from '@jest/globals';

describe('Rotas /v1/banks', () => {
  let app;

  beforeAll(async () => {
    // Mocks em ambiente ESM
    await jest.unstable_mockModule('../../middlewares/authorizeAccessUser.js', () => ({
      authorizeAccessUser: (_req, _res, next) => next(),
    }));
    await jest.unstable_mockModule('../../middlewares/authorizeAccessAdmin.js', () => ({
      authorizeAccessAdmin: (_req, _res, next) => next(),
    }));
    await jest.unstable_mockModule('../../config/bank.logger.js', () => ({
      default: { info: jest.fn(), error: jest.fn() },
    }));
    await jest.unstable_mockModule('../../config/bank.database.js', () => ({
      default: undefined,
    }));
    await jest.unstable_mockModule('../../models/bank.model.js', () => {
      const find = jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
      const findById = jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      const findByIdAndUpdate = jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      const findByIdAndDelete = jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

      function Bank(data) {
        Object.assign(this, { _id: 'abc123', status: 'active' }, data);
        this.save = jest.fn().mockResolvedValue(undefined);
      }
      Bank.find = find;
      Bank.findById = findById;
      Bank.findByIdAndUpdate = findByIdAndUpdate;
      Bank.findByIdAndDelete = findByIdAndDelete;

      return { __esModule: true, default: Bank };
    });

    const { createServer } = await import('../../index.js');
    app = createServer();
  });

  test('GET /v1/banks retorna lista vazia', async () => {
    const res = await request(app).get('/v1/banks');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('GET /v1/banks/:id retorna 404 quando não existe', async () => {
    const res = await request(app).get('/v1/banks/656565656565656565656565');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Bank not found' });
  });

  test('POST /v1/banks cria novo banco (201)', async () => {
    const res = await request(app)
      .post('/v1/banks')
      .send({ name: 'Meu Banco', code: 'MB' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Meu Banco', code: 'MB', status: 'active' });
  });

  test('PUT /v1/banks/:id retorna 404 quando não existe', async () => {
    const BankModule = await import('../../models/bank.model.js');
    // Simula banco não encontrado
    BankModule.default.findByIdAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    const res = await request(app)
      .put('/v1/banks/656565656565656565656565')
      .send({ name: 'Banco Atualizado' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Bank not found' });
  });

  test('PUT /v1/banks/:id atualiza e retorna 200', async () => {
    const BankModule = await import('../../models/bank.model.js');
    const updated = { _id: 'abc123', name: 'Banco Atualizado', code: 'MB', status: 'active' };
    BankModule.default.findByIdAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue(updated) });

    const res = await request(app)
      .put('/v1/banks/abc123')
      .send({ name: 'Banco Atualizado' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject(updated);
  });

  test('DELETE /v1/banks/:id retorna 404 quando não existe', async () => {
    const BankModule = await import('../../models/bank.model.js');
    BankModule.default.findByIdAndDelete.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    const res = await request(app).delete('/v1/banks/656565656565656565656565');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Bank not found' });
  });

  test('DELETE /v1/banks/:id exclui e retorna 204', async () => {
    const BankModule = await import('../../models/bank.model.js');
    const deleted = { _id: 'abc123', name: 'Meu Banco', code: 'MB', status: 'active' };
    BankModule.default.findByIdAndDelete.mockReturnValue({ lean: jest.fn().mockResolvedValue(deleted) });

    const res = await request(app).delete('/v1/banks/abc123');
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
  });
});
