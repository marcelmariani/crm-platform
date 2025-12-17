// src/utils/run-bootstrap-once.js
import '../config/database.js';
import { runBootstrapOnStart } from './bootstrapOnStart.js';

try {
  await runBootstrapOnStart();
  console.log('[bootstrap] finished');
} catch (err) {
  console.error('[bootstrap] failed:', err?.message || err);
  process.exitCode = 1;
}
