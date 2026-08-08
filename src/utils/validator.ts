// src/utils/validator.ts

export interface LogEntry {
  timestamp: string;
  level: string;
  service: string;
  message: string;
  attributes?: Record<string, any>;
}

const VALID_LEVELS = ['debug', 'info', 'warn', 'error'];

export function validateLogEntry(entry: any): string | null {
  if (!entry || typeof entry !== 'object') {
    return 'entry must be an object';
  }

  if (!entry.timestamp || typeof entry.timestamp !== 'string') {
    return 'timestamp is required and must be a string';
  }
  const timestampDate = new Date(entry.timestamp);
  if (isNaN(timestampDate.getTime())) {
    return 'timestamp must be a valid ISO 8601 timestamp';
  }
  
  const fiveMinutesInFuture = new Date(Date.now() + 5 * 60 * 1000);
  if (timestampDate > fiveMinutesInFuture) {
    return 'timestamp must not be more than five minutes in the future';
  }

  if (!entry.level || typeof entry.level !== 'string') {
    return `level is required and must be a string`;
  }
  const normalizedLevel = entry.level.toLowerCase();
  if (!VALID_LEVELS.includes(normalizedLevel)) {
    return `level is required and must be one of: ${VALID_LEVELS.join(', ')}`;
  }
  entry.level = normalizedLevel;
  // --------------------------------------------------

  if (!entry.service || typeof entry.service !== 'string' || entry.service.trim() === '') {
    return 'service is required and must be a non-empty string';
  }

  if (!entry.message || typeof entry.message !== 'string' || entry.message.trim() === '') {
    return 'message is required and must be a non-empty string';
  }

  if (entry.attributes !== undefined) {
    if (entry.attributes === null || typeof entry.attributes !== 'object' || Array.isArray(entry.attributes)) {
      return 'attributes must be a flat object';
    }

    for (const [key, value] of Object.entries(entry.attributes)) {
      const valType = typeof value;
      if (valType !== 'string' && valType !== 'number' && valType !== 'boolean') {
        return `attribute '${key}' must have a string, number, or boolean value; nested objects and arrays are not allowed`;
      }
    }
  }

  return null; 
}