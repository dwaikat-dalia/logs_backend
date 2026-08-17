import assert from "node:assert";
import test from "node:test";

const BASE_URL = "http://localhost:8080";

test("POST /logs accepts a valid log batch", async () => {
  const response = await fetch(`${BASE_URL}/logs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      logs: [
        {
          timestamp: new Date().toISOString(),
          level: "info",
          service: "test-service",
          message: "API test log",
          attributes: {
            source: "test",
            count: 1,
            active: true,
          },
        },
      ],
    }),
  });

  const body = await response.json();

  assert.strictEqual(response.status, 200);
  assert.strictEqual(body.accepted, 1);
  assert.strictEqual(body.rejected.length, 0);
});

test("POST /logs rejects an invalid log", async () => {
  const response = await fetch(`${BASE_URL}/logs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      logs: [
        {
          timestamp: new Date().toISOString(),
          level: "invalid-level",
          service: "",
          message: "",
        },
      ],
    }),
  });

  const body = await response.json();

  assert.strictEqual(response.status, 400);
  assert.strictEqual(body.accepted, 0);
  assert.strictEqual(body.rejected.length, 1);
});
test("GET /logs returns logs", async () => {
  const response = await fetch(`${BASE_URL}/logs?limit=5`);

  const body = await response.json();

  assert.strictEqual(response.status, 200);
  assert.ok(Array.isArray(body.logs));
  assert.ok("next_cursor" in body);
});

test("GET /logs respects the limit parameter", async () => {
  const response = await fetch(`${BASE_URL}/logs?limit=3`);

  const body = await response.json();

  assert.strictEqual(response.status, 200);
  assert.ok(body.logs.length <= 3);
});
test("GET /logs filters by service", async () => {
  const response = await fetch(
    `${BASE_URL}/logs?service=auth&limit=10`
  );

  const body = await response.json();

  assert.strictEqual(response.status, 200);
  assert.ok(Array.isArray(body.logs));

  for (const log of body.logs) {
    assert.strictEqual(log.service, "auth");
  }
});
test("GET /logs filters by level", async () => {
  const response = await fetch(
    `${BASE_URL}/logs?level=error&limit=10`
  );

  const body = await response.json();

  assert.strictEqual(response.status, 200);
  assert.ok(Array.isArray(body.logs));

  for (const log of body.logs) {
    assert.strictEqual(log.level, "error");
  }
});

test("GET /logs searches messages with q", async () => {
  const response = await fetch(
    `${BASE_URL}/logs?q=Test%20log%20message&limit=10`
  );

  const body = await response.json();

  assert.strictEqual(response.status, 200);
  assert.ok(Array.isArray(body.logs));

  for (const log of body.logs) {
    assert.ok(
      log.message.toLowerCase().includes("test log message")
    );
  }
});
test("GET /logs supports cursor pagination", async () => {
  const firstResponse = await fetch(
    `${BASE_URL}/logs?limit=3`
  );

  const firstBody = await firstResponse.json();

  assert.strictEqual(firstResponse.status, 200);
  assert.ok(Array.isArray(firstBody.logs));
  assert.ok(firstBody.next_cursor);

  const secondResponse = await fetch(
    `${BASE_URL}/logs?limit=3&cursor=${encodeURIComponent(
      firstBody.next_cursor
    )}`
  );

  const secondBody = await secondResponse.json();

  assert.strictEqual(secondResponse.status, 200);
  assert.ok(Array.isArray(secondBody.logs));

  const firstIds = new Set(
    firstBody.logs.map((log: { id: string }) => log.id)
  );

  for (const log of secondBody.logs) {
    assert.ok(!firstIds.has(log.id));
  }
});
test("GET /logs rejects an invalid cursor", async () => {
  const response = await fetch(
    `${BASE_URL}/logs?cursor=invalid-cursor`
  );

  const body = await response.json();

  assert.strictEqual(response.status, 400);
  assert.strictEqual(
    body.error,
    "Invalid or malformed cursor."
  );
});
test("GET /logs rejects an invalid limit", async () => {
  const response = await fetch(
    `${BASE_URL}/logs?limit=0`
  );

  const body = await response.json();

  assert.strictEqual(response.status, 400);
  assert.strictEqual(
    body.error,
    "Invalid limit parameter. Must be between 1 and 1000."
  );
});
//-----------
test("GET /logs/aggregate requires required parameters", async () => {
  const response = await fetch(
    `${BASE_URL}/logs/aggregate`
  );

  const body = await response.json();

  assert.strictEqual(response.status, 400);
  assert.strictEqual(body.error, "since is required.");
});
test("GET /logs/aggregate rejects an invalid bucket", async () => {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const until = new Date().toISOString();

  const response = await fetch(
    `${BASE_URL}/logs/aggregate?since=${encodeURIComponent(
      since
    )}&until=${encodeURIComponent(
      until
    )}&bucket=10m`
  );

  const body = await response.json();

  assert.strictEqual(response.status, 400);
  assert.strictEqual(
    body.error,
    "Invalid bucket. Must be 1m, 5m, 1h, or 1d."
  );
});
test("GET /logs/aggregate returns aggregation buckets", async () => {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const until = new Date().toISOString();

  const response = await fetch(
    `${BASE_URL}/logs/aggregate?since=${encodeURIComponent(
      since
    )}&until=${encodeURIComponent(
      until
    )}&bucket=1h`
  );

  const body = await response.json();

  assert.strictEqual(response.status, 200);
  assert.ok(Array.isArray(body.buckets));

  for (const bucket of body.buckets) {
    assert.ok("start" in bucket);
    assert.ok("group" in bucket);
    assert.ok("count" in bucket);
    assert.strictEqual(typeof bucket.count, "number");
  }
});
test("GET /logs/aggregate groups by service", async () => {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const until = new Date().toISOString();

  const response = await fetch(
    `${BASE_URL}/logs/aggregate?since=${encodeURIComponent(
      since
    )}&until=${encodeURIComponent(
      until
    )}&bucket=1h&group_by=service`
  );

  const body = await response.json();

  assert.strictEqual(response.status, 200);
  assert.ok(Array.isArray(body.buckets));

  for (const bucket of body.buckets) {
    assert.ok(typeof bucket.group === "string");
    assert.strictEqual(typeof bucket.count, "number");
  }
});
test("GET /logs/aggregate groups by level", async () => {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const until = new Date().toISOString();

  const response = await fetch(
    `${BASE_URL}/logs/aggregate?since=${encodeURIComponent(
      since
    )}&until=${encodeURIComponent(
      until
    )}&bucket=1h&group_by=level`
  );

  const body = await response.json();

  assert.strictEqual(response.status, 200);
  assert.ok(Array.isArray(body.buckets));

  const validLevels = ["debug", "info", "warn", "error"];

  for (const bucket of body.buckets) {
    assert.ok(validLevels.includes(bucket.group));
    assert.strictEqual(typeof bucket.count, "number");
  }
});
test("GET /logs/aggregate rejects an invalid group_by", async () => {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const until = new Date().toISOString();

  const response = await fetch(
    `${BASE_URL}/logs/aggregate?since=${encodeURIComponent(
      since
    )}&until=${encodeURIComponent(
      until
    )}&bucket=1h&group_by=invalid`
  );

  const body = await response.json();

  assert.strictEqual(response.status, 400);
  assert.strictEqual(
    body.error,
    "Invalid group_by. Must be service or level."
  );
});