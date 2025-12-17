// src/controllers/productController.js
import Product from '../models/productModel.js';

// LIST
export async function findAll(req, res, next) {
  try {
    const list = await Product.find().limit(100).lean();
    res.json(list);
  } catch (err) { next(err); }
}

export async function findById(req, res, next) {
  try {
    const doc = await Product.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ message: 'Product not found' });
    res.json(doc);
  } catch (err) { next(err); }
}

// CREATE
export async function create(req, res, next) {
  try {
    // compat: aceita PT-BR por alias
    const body = req.body || {};
    const doc = await Product.create(body);
    res.status(201).json(doc);
  } catch (err) { next(err); }
}

// UPDATE (PUT)
export async function update(req, res, next) {
  try {
    const doc = await Product.findByIdAndUpdate(
      req.params.id,
      req.body || {},
      { new: true, runValidators: true }
    );
    if (!doc) return res.status(404).json({ message: 'Product not found' });
    res.json(doc);
  } catch (err) { next(err); }
}

// PATCH
export async function partialUpdate(req, res, next) {
  try {
    const doc = await Product.findByIdAndUpdate(
      req.params.id,
      req.body || {},
      { new: true, runValidators: true }
    );
    if (!doc) return res.status(404).json({ message: 'Product not found' });
    res.json(doc);
  } catch (err) { next(err); }
}

// DELETE
export async function remove(req, res, next) {
  try {
    const r = await Product.findByIdAndDelete(req.params.id);
    if (!r) return res.status(404).json({ message: 'Product not found' });
    res.status(204).send();
  } catch (err) { next(err); }
}

// STATUS
export async function activate(req, res, next) {
  try {
    const doc = await Product.findByIdAndUpdate(
      req.params.id,
      { status: 'active' },
      { new: true, runValidators: true }
    );
    if (!doc) return res.status(404).json({ message: 'Product not found' });
    res.json(doc);
  } catch (err) { next(err); }
}

export async function deactivate(req, res, next) {
  try {
    const doc = await Product.findByIdAndUpdate(
      req.params.id,
      { status: 'inactive' },
      { new: true, runValidators: true }
    );
    if (!doc) return res.status(404).json({ message: 'Product not found' });
    res.json(doc);
  } catch (err) { next(err); }
}