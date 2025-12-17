// src/middlewares/validate.js
export const validate =
  (schema) =>
  (req, res, next) => {
    const data = { body: req.body, params: req.params, query: req.query };
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'validation_error',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    Object.assign(req, parsed.data);
    return next();
  };
