import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateLogEntry } from "../src/utils/validator";

describe("validateLogEntry", () => {
  const validLog = {
    timestamp: new Date().toISOString(),
    level: "info",
    service: "checkout",
    message: "payment successful",
    attributes: {
      user_id: "42",
      retries: 3,
      successful: true,
    },
  };

  it("accepts a valid log entry", () => {
    assert.equal(validateLogEntry(validLog), null);
  });

  it("rejects a missing timestamp", () => {
    const log = { ...validLog, timestamp: undefined };

    assert.match(
      validateLogEntry(log) ?? "",
      /timestamp/
    );
  });

  it("rejects an invalid timestamp", () => {
    const log = {
      ...validLog,
      timestamp: "not-a-date",
    };

    assert.match(
      validateLogEntry(log) ?? "",
      /timestamp/
    );
  });

it("rejects timestamp without timezone", () => {
  const log = {
    ...validLog,
    timestamp: "2026-07-20T14:32:01.123",
  };

  assert.match(
    validateLogEntry(log) ?? "",
    /ISO 8601/
  );
});

it("rejects date-only timestamp", () => {
  const log = {
    ...validLog,
    timestamp: "2026-07-20",
  };

  assert.match(
    validateLogEntry(log) ?? "",
    /ISO 8601/
  );
});

it("accepts ISO 8601 timestamp with timezone offset", () => {
  const log = {
    ...validLog,
    timestamp: "2026-07-20T14:32:01.123+03:00",
  };

  assert.equal(validateLogEntry(log), null);
});
  it("rejects a timestamp more than five minutes in the future", () => {
    const future = new Date(
      Date.now() + 6 * 60 * 1000
    ).toISOString();

    const log = {
      ...validLog,
      timestamp: future,
    };

    assert.match(
      validateLogEntry(log) ?? "",
      /five minutes in the future/
    );
  });

  it("accepts a timestamp up to five minutes in the future", () => {
    const future = new Date(
      Date.now() + 4 * 60 * 1000
    ).toISOString();

    const log = {
      ...validLog,
      timestamp: future,
    };

    assert.equal(validateLogEntry(log), null);
  });

  it("rejects an invalid level", () => {
    const log = {
      ...validLog,
      level: "critical",
    };

    assert.match(
      validateLogEntry(log) ?? "",
      /level/
    );
  });

  it("rejects an empty service", () => {
    const log = {
      ...validLog,
      service: "",
    };

    assert.match(
      validateLogEntry(log) ?? "",
      /service/
    );
  });

  it("rejects an empty message", () => {
    const log = {
      ...validLog,
      message: "",
    };

    assert.match(
      validateLogEntry(log) ?? "",
      /message/
    );
  });

  it("accepts string, number, and boolean attributes", () => {
    const log = {
      ...validLog,
      attributes: {
        user_id: "42",
        retries: 3,
        successful: true,
      },
    };

    assert.equal(validateLogEntry(log), null);
  });

  it("rejects array attributes", () => {
    const log = {
      ...validLog,
      attributes: ["invalid"],
    };

    assert.match(
      validateLogEntry(log) ?? "",
      /attributes/
    );
  });

  it("rejects nested attributes", () => {
    const log = {
      ...validLog,
      attributes: {
        user: {
          id: 42,
        },
      },
    };

    assert.match(
      validateLogEntry(log) ?? "",
      /attribute 'user'/
    );
  });

  it("rejects null attributes", () => {
    const log = {
      ...validLog,
      attributes: null,
    };

    assert.match(
      validateLogEntry(log) ?? "",
      /attributes/
    );
  });

  it("accepts logs without attributes", () => {
    const { attributes, ...logWithoutAttributes } = validLog;

    assert.equal(
      validateLogEntry(logWithoutAttributes),
      null
    );
  });

  it("rejects a non-object log entry", () => {
    assert.match(
      validateLogEntry(null) ?? "",
      /entry/
    );

    assert.match(
      validateLogEntry([]) ?? "",
      /entry/
    );
  });
});
