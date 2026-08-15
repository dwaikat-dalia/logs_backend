import { performance } from "perf_hooks";

const LOGS_URL = "http://localhost:8080/logs";
const AGGREGATE_URL =
  "http://localhost:8080/logs/aggregate?since=2026-08-12T08:00:00Z&until=2026-08-12T09:00:00Z&bucket=1m";

const TOTAL_LOGS_TO_SEND = 100000;
const BATCH_SIZE = 2000;
const CONCURRENT_REQUESTS = 1;

interface LogEntry {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  service: string;
  message: string;
  attributes: Record<string, string | number | boolean>;
}

function generateBatch(size: number): { logs: LogEntry[] } {
  const levels: LogEntry["level"][] = [
    "debug",
    "info",
    "warn",
    "error",
  ];

  const services = [
    "checkout",
    "auth",
    "payment",
    "inventory",
  ];

  const logs: LogEntry[] = [];

  for (let i = 0; i < size; i++) {
    logs.push({
      timestamp: new Date().toISOString(),
      level: levels[Math.floor(Math.random() * levels.length)],
      service: services[Math.floor(Math.random() * services.length)],
      message: `Test log message number ${Math.random()}`,
      attributes: {
        user_id: String(Math.floor(Math.random() * 10000)),
        region: "eu-west",
        retries: Math.floor(Math.random() * 5),
      },
    });
  }

  return { logs };
}

async function sendBatch(
  batch: { logs: LogEntry[] }
): Promise<boolean> {
  try {
    const response = await fetch(LOGS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(batch),
    });

    return response.ok;
  } catch {
    return false;
  }
}

async function runIngestion(): Promise<void> {
  const totalBatches = Math.ceil(
    TOTAL_LOGS_TO_SEND / BATCH_SIZE
  );

  let successfulLogs = 0;
  let failedBatches = 0;

  for (
    let i = 0;
    i < totalBatches;
    i += CONCURRENT_REQUESTS
  ) {
    const promises: Promise<{
      success: boolean;
      size: number;
    }>[] = [];

    for (
      let j = 0;
      j < CONCURRENT_REQUESTS &&
      i + j < totalBatches;
      j++
    ) {
      const batchIndex = i + j;

      const currentBatchSize = Math.min(
        BATCH_SIZE,
        TOTAL_LOGS_TO_SEND -
          batchIndex * BATCH_SIZE
      );

      const batch = generateBatch(currentBatchSize);

      promises.push(
        sendBatch(batch).then((success) => ({
          success,
          size: currentBatchSize,
        }))
      );
    }

    const results = await Promise.all(promises);

    for (const result of results) {
      if (result.success) {
        successfulLogs += result.size;
      } else {
        failedBatches++;
      }
    }

    process.stdout.write(
      `\rIngestion: ${successfulLogs}/${TOTAL_LOGS_TO_SEND}`
    );
  }

  console.log(
    `\nIngestion finished. Failed batches: ${failedBatches}`
  );
}

async function runAggregationMonitor(
  durationMs: number
): Promise<number[]> {
  const latencies: number[] = [];

  const start = performance.now();

  while (performance.now() - start < durationMs) {
    const requestStart = performance.now();

    try {
      const response = await fetch(AGGREGATE_URL);

      const latency =
        performance.now() - requestStart;

      if (response.ok) {
        latencies.push(latency);
      } else {
        console.log(
          `\nAggregation failed: HTTP ${response.status}`
        );
      }
    } catch (error) {
      console.log("\nAggregation request failed.");
    }

    const elapsed =
      performance.now() - requestStart;

    const waitTime = Math.max(
      0,
      1000 - elapsed
    );

    await new Promise((resolve) =>
      setTimeout(resolve, waitTime)
    );
  }

  return latencies;
}

function percentile(
  values: number[],
  percentileValue: number
): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort(
    (a, b) => a - b
  );

  const index = Math.ceil(
    (percentileValue / 100) *
      sorted.length
  ) - 1;

  return sorted[Math.max(0, index)];
}

async function main() {
  console.log(
    "\nStarting ingestion + aggregation test..."
  );

  console.log(
    `Ingestion: ${TOTAL_LOGS_TO_SEND} logs`
  );

  console.log(
    `Aggregation: ~1 request/second`
  );

  const testDuration = 15000;

  const aggregationPromise =
    runAggregationMonitor(testDuration);

  const ingestionPromise = runIngestion();

  const [, latencies] = await Promise.all([
    ingestionPromise,
    aggregationPromise,
  ]);

  console.log(
    "\n\n--- Aggregation Results ---"
  );

  console.log(
    `Requests: ${latencies.length}`
  );

  if (latencies.length === 0) {
    console.log("No successful aggregation requests.");
    return;
  }

  const average =
    latencies.reduce(
      (sum, value) => sum + value,
      0
    ) / latencies.length;

  console.log(
    `Min:  ${Math.min(...latencies).toFixed(2)} ms`
  );

  console.log(
    `Avg:  ${average.toFixed(2)} ms`
  );

  console.log(
    `P50:  ${percentile(latencies, 50).toFixed(2)} ms`
  );

  console.log(
    `P95:  ${percentile(latencies, 95).toFixed(2)} ms`
  );

  console.log(
    `P99:  ${percentile(latencies, 99).toFixed(2)} ms`
  );

  console.log(
    `Max:  ${Math.max(...latencies).toFixed(2)} ms`
  );
}

main();