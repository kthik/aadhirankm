import { config } from '../config.js';

/**
 * Tiny declarative validator. Rules are per-field arrays of check names;
 * returns { ok, values, errors } with errors keyed by field for the UI.
 */
export function validate(body, rules) {
  const cfg = config().validation;
  const values = {};
  const errors = {};

  for (const [field, spec] of Object.entries(rules)) {
    const raw = body?.[field];
    const label = spec.label ?? field;
    let value = typeof raw === 'string' ? raw.trim() : raw;

    if (value === undefined || value === null || value === '' ||
        (Array.isArray(value) && value.length === 0)) {
      if (spec.required) errors[field] = `${label} is required`;
      else values[field] = spec.type === 'array' ? [] : (spec.default ?? null);
      continue;
    }

    switch (spec.type) {
      case 'phone':
        if (!new RegExp(cfg.phonePattern).test(String(value))) {
          errors[field] = `${label} must be a valid 10-digit mobile number`;
        }
        value = String(value);
        break;
      case 'age': {
        const n = Number(value);
        if (!Number.isInteger(n) || n < cfg.minAge || n > cfg.maxAge) {
          errors[field] = `${label} must be between ${cfg.minAge} and ${cfg.maxAge}`;
        }
        value = n;
        break;
      }
      case 'array':
        if (!Array.isArray(value)) errors[field] = `${label} must be a list`;
        break;
      case 'password':
        if (String(value).length < 6) errors[field] = `${label} must be at least 6 characters`;
        break;
      default:
        value = String(value);
        if (spec.min && value.length < spec.min) {
          errors[field] = `${label} must be at least ${spec.min} characters`;
        }
    }
    values[field] = value;
  }

  return { ok: Object.keys(errors).length === 0, values, errors };
}
