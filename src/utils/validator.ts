// src/utils/validator.ts

export function validateLogEntry(entry: any): string | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return 'entry must be a valid object';
  }

  if (typeof entry.timestamp !== 'string') {
    return 'timestamp is required and must be a string';
  }
  const timeMs = Date.parse(entry.timestamp);
  if (Number.isNaN(timeMs)) {
    return 'timestamp must be a valid ISO 8601 timestamp';
  }
  
  if (timeMs > Date.now() + 300000) {
    return 'timestamp must not be more than five minutes in the future';
  }

  const level = entry.level;
  if (level !== 'debug' && level !== 'info' && level !== 'warn' && level !== 'error') {
    return "level is required and must be one of: debug, info, warn, error";
  }

  if (typeof entry.service !== 'string' || entry.service.length === 0) {
    return 'service is required and must be a non-empty string';
  }

  if (typeof entry.message !== 'string' || entry.message.length === 0) {
    return 'message is required and must be a non-empty string';
  }

  if (entry.attributes !== undefined) {
    const attrs = entry.attributes;
    if (attrs === null || typeof attrs !== 'object' || Array.isArray(attrs)) {
      return 'attributes must be a flat object';
    }

    for (const key in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, key)) {
        const val = attrs[key];
        const valType = typeof val;
        if (valType !== 'string' && valType !== 'number' && valType !== 'boolean') {
          return `attribute '${key}' must have a string, number, or boolean value`;
        }
      }
    }
  }

  return null;
}