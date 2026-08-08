import { performance } from "perf_hooks";

const TARGET_URL = "http://localhost:8080/logs";
/*const TOTAL_LOGS_TO_SEND = 50; // 
const BATCH_SIZE = 50; 
const CONCURRENT_REQUESTS = 1; //Successful*/
/*const TOTAL_LOGS_TO_SEND = 5000;
const BATCH_SIZE = 500; //
const CONCURRENT_REQUESTS = 2;// Successful 
*/
const TOTAL_LOGS_TO_SEND = 15000;
const BATCH_SIZE = 5000; // 
const CONCURRENT_REQUESTS = 3; // Successful in 13 second
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

async function sendBatch(batch: { logs: LogEntry[] }): Promise<boolean> {
  try {
    const response = await fetch(TARGET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`\n❌ Error Status ${response.status}:`, errorText);
    }

    return response.ok;
  } catch (error) {
    console.log(`\n❌ Network Connection Error:`, error);
    return false;
  }
}

async function runLoadTest() {
  console.log(`Starting local load test: Sending ${TOTAL_LOGS_TO_SEND} logs...`);
  
  const totalBatches = Math.ceil(TOTAL_LOGS_TO_SEND / BATCH_SIZE);
  let completedBatches = 0;
  let successfulLogs = 0;

  const startTime = performance.now();

  for (let i = 0; i < totalBatches; i += CONCURRENT_REQUESTS) {
    const chunkPromises = [];
    
    for (let j = 0; j < CONCURRENT_REQUESTS && (i + j) < totalBatches; j++) {
      const batch = generateBatch(BATCH_SIZE);
      chunkPromises.push(
        sendBatch(batch).then((success) => {
          if (success) successfulLogs += BATCH_SIZE;
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

  console.log("\n--- Load Test Results ---");
  console.log(`Total Successful Logs: ${successfulLogs}`);
  console.log(`Total Time: ${durationInSeconds.toFixed(2)} seconds`);
  console.log(`Throughput: ${logsPerSecond} logs/second`);
}

runLoadTest();