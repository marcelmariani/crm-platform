import Bank from '../models/bank.model.js';
import logger from '../config/bank.logger.js';

export const createBank = async (req, res) => {
  try {
    const bank = new Bank(req.body);
    await bank.save();
    logger.info(`Bank created: ${bank._id}`);
    res.status(201).json(bank);
  } catch (error) {
    logger.error(`Error creating bank: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
};

export const getBanks = async (_req, res) => {
  try {
    const banks = await Bank.find().lean();
    res.json(banks);
  } catch (error) {
    logger.error(`Error fetching banks: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
};

export const getBankById = async (req, res) => {
  try {
    const { id } = req.params;
    const bank = await Bank.findById(id).lean();
    if (!bank) return res.status(404).json({ error: 'Bank not found' });
    res.json(bank);
  } catch (error) {
    logger.error(`Error fetching bank by id: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
};

export const updateBank = async (req, res) => {
  try {
    const { id } = req.params;
    const bank = await Bank.findByIdAndUpdate(id, req.body, { new: true, runValidators: true }).lean();
    if (!bank) return res.status(404).json({ error: 'Bank not found' });
    logger.info(`Bank updated: ${bank._id}`);
    res.json(bank);
  } catch (error) {
    logger.error(`Error updating bank: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
};

export const deleteBank = async (req, res) => {
  try {
    const { id } = req.params;
    const bank = await Bank.findByIdAndDelete(id).lean();
    if (!bank) return res.status(404).json({ error: 'Bank not found' });
    logger.info(`Bank deleted: ${id}`);
    res.status(204).send();
  } catch (error) {
    logger.error(`Error deleting bank: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
};
