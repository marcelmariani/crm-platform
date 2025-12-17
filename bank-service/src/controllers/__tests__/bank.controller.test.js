import { jest } from '@jest/globals';

// Mock logger
await jest.unstable_mockModule('../../config/bank.logger.js', () => ({
  default: { info: jest.fn(), error: jest.fn() },
}));

// Mock modelo Bank com API usada pelos controllers
const findMock = jest.fn();
const findByIdMock = jest.fn();
const findByIdAndUpdateMock = jest.fn();
const findByIdAndDeleteMock = jest.fn();

await jest.unstable_mockModule('../../models/bank.model.js', () => ({
  __esModule: true,
  default: {
    find: findMock,
    findById: findByIdMock,
    findByIdAndUpdate: findByIdAndUpdateMock,
    findByIdAndDelete: findByIdAndDeleteMock,
  },
}));

const { createBank, getBanks, getBankById, updateBank, deleteBank } = await import('../bank.controller.js');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
}

describe('bank.controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('getBanks sucesso retorna array', async () => {
    const res = mockRes();
    findMock.mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: '1' }]) });
    await getBanks({}, res);
    expect(res.json).toHaveBeenCalledWith([{ _id: '1' }]);
  });

  test('getBanks erro retorna 500', async () => {
    const res = mockRes();
    findMock.mockImplementation(() => { throw new Error('db fail'); });
    await getBanks({}, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  test('getBankById 404 quando não existe', async () => {
    const res = mockRes();
    findByIdMock.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    await getBankById({ params: { id: 'x' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Bank not found' });
  });

  test('getBankById sucesso retorna doc', async () => {
    const res = mockRes();
    findByIdMock.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: '1' }) });
    await getBankById({ params: { id: '1' } }, res);
    expect(res.json).toHaveBeenCalledWith({ _id: '1' });
  });

  test('updateBank 404 quando não existe', async () => {
    const res = mockRes();
    findByIdAndUpdateMock.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    await updateBank({ params: { id: 'x' }, body: { name: 'n' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Bank not found' });
  });

  test('updateBank sucesso retorna doc', async () => {
    const res = mockRes();
    const doc = { _id: '1', name: 'n' };
    findByIdAndUpdateMock.mockReturnValue({ lean: jest.fn().mockResolvedValue(doc) });
    await updateBank({ params: { id: '1' }, body: { name: 'n' } }, res);
    expect(res.json).toHaveBeenCalledWith(doc);
  });

  test('updateBank erro retorna 400', async () => {
    const res = mockRes();
    findByIdAndUpdateMock.mockImplementation(() => { throw new Error('validation'); });
    await updateBank({ params: { id: '1' }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  test('deleteBank 404 quando não existe', async () => {
    const res = mockRes();
    findByIdAndDeleteMock.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    await deleteBank({ params: { id: 'x' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Bank not found' });
  });

  test('deleteBank sucesso retorna 204', async () => {
    const res = mockRes();
    findByIdAndDeleteMock.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: '1' }) });
    await deleteBank({ params: { id: '1' } }, res);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });

  test('deleteBank erro retorna 500', async () => {
    const res = mockRes();
    findByIdAndDeleteMock.mockImplementation(() => { throw new Error('db'); });
    await deleteBank({ params: { id: '1' } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });
});
