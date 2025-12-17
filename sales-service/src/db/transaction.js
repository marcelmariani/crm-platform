// src/db/transaction.js
import mongoose from 'mongoose';

export async function withTxn(work, { txnOptions } = {}) {
  const session = await mongoose.startSession();
  let committed = false;
  try {
    await session.startTransaction(txnOptions);
    const result = await work(session);
    await session.commitTransaction();
    committed = true;
    return result;
  } catch (err) {
    try {
      if (session.inTransaction() && !committed) {
        await session.abortTransaction();
      }
    } catch {}
    throw err;
  } finally {
    await session.endSession();
  }
}
