interface CursorPayload {
  timestamp: string;
  id: string;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const payload = JSON.parse(decoded);

    if (
      typeof payload.timestamp !== 'string' ||
      typeof payload.id !== 'string'
    ) {
      throw new Error('Invalid cursor');
    }

    const date = new Date(payload.timestamp);

    if (isNaN(date.getTime())) {
      throw new Error('Invalid cursor timestamp');
    }

    return payload;
  } catch {
    throw new Error('Invalid cursor');
  }
}