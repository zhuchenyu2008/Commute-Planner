import { NextResponse } from "next/server";
import { isSchedulerAuthorized } from "@/lib/scheduler/auth";
import { processDueReminderJobs } from "@/lib/scheduler/process-job";

export async function POST(request: Request) {
  if (!isSchedulerAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await processDueReminderJobs();

  return NextResponse.json(result);
}
