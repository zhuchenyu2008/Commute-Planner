import { processDueReminderJobs } from "@/lib/scheduler/process-job";

async function main() {
  try {
    const result = await processDueReminderJobs();
    console.log(JSON.stringify({ ok: true, ...result }));
  } catch (error) {
    console.log(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : "Scheduler tick failed",
      })
    );
    process.exitCode = 1;
  }
}

void main();
