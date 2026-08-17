import { performance } from "perf_hooks";

const TARGET_URL = "http://localhost:8080/logs";

const TOTAL_LOGS_TO_SEND = 100000; 
const BATCH_SIZE = 2000;          // <--
const CONCURRENT_REQUESTS =1;    // <--    

interface LogEntry {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  service: string;
  message: string;
  attributes: Record<string, string | number | boolean>;
}

function generateBatch(size: number): { logs: LogEntry[] } {
  const levels: Array<"debug" | "info" | "warn" | "error"> = ["debug", "info", "warn", "error"];
  const services = ["checkout", "auth", "payment", "inventory"];
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

async function sendBatch(batch: { logs: LogEntry[] }): Promise<{ success: boolean; duration: number }> {
  const start = performance.now();
  try {
    const response = await fetch(TARGET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch),
    });

    const duration = performance.now() - start;
    return { success: response.ok, duration };
  } catch (error) {
    const duration = performance.now() - start;
    return { success: false, duration };
  }
}

async function runLoadTest() {
  console.log(`Starting local load test: Sending ${TOTAL_LOGS_TO_SEND} logs...`);
  console.log(`Batch Size: ${BATCH_SIZE} | Concurrency: ${CONCURRENT_REQUESTS}\n`);
  
  const totalBatches = Math.ceil(TOTAL_LOGS_TO_SEND / BATCH_SIZE);
  let completedBatches = 0;
  let successfulLogs = 0;
  let failedBatches = 0;
  let totalLatency = 0;
  let minLatency = Infinity;
  let maxLatency = 0;

  const startTime = performance.now();

  for (let i = 0; i < totalBatches; i += CONCURRENT_REQUESTS) {
    const chunkPromises = [];
    
    for (let j = 0; j < CONCURRENT_REQUESTS && (i + j) < totalBatches; j++) {
      const currentBatchSize = Math.min(BATCH_SIZE, TOTAL_LOGS_TO_SEND - (i + j) * BATCH_SIZE);
      const batch = generateBatch(currentBatchSize);
      
      chunkPromises.push(
        sendBatch(batch).then(({ success, duration }) => {
          if (success) {
            successfulLogs += currentBatchSize;
          } else {
            failedBatches++;
          }
          totalLatency += duration;
          if (duration < minLatency) minLatency = duration;
          if (duration > maxLatency) maxLatency = duration;
        })
      );
    }

    await Promise.all(chunkPromises);
    completedBatches += CONCURRENT_REQUESTS;
    process.stdout.write(`Progress: ~${Math.min(completedBatches * BATCH_SIZE, TOTAL_LOGS_TO_SEND)} logs sent...\r`);
  }

  const endTime = performance.now();
  const durationInSeconds = (endTime - startTime) / 1000;
  const logsPerSecond = successfulLogs > 0 ? Math.round(successfulLogs / durationInSeconds) : 0;
  const avgLatency = totalBatches > 0 ? (totalLatency / totalBatches).toFixed(2) : 0;

  console.log("\n\n--- Load Test Final Results ---");
  console.log(`Total Successful Logs: ${successfulLogs}`);
  console.log(`Failed Batches:        ${failedBatches}`);
  console.log(`Total Time:          ${durationInSeconds.toFixed(2)} seconds`);
  console.log(`Throughput:          ${logsPerSecond} logs/second`);
  console.log(`Avg Request Latency: ${avgLatency} ms`);
  console.log(`Min/Max Latency:     ${minLatency.toFixed(2)}ms / ${maxLatency.toFixed(2)}ms`);
}

runLoadTest();