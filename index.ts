/// <reference types="node" />
import { exec } from "child_process";

const TOGGL_WORKSPACE_ID = "1150757";
const TOGGL_LP_WORKSPACE_ID = "5431223";

// Parse goal input (examples: "6", "6:00", "6.0" -> 6 hours; "3.5" or "3:30" -> 3.5 hours; "7:25" -> 7 hours 25 minutes)
function parseGoalTime(input: string): number {
  input = input.trim();
  if (!input) throw new Error("Goal time input is empty");
  // If format is HH:MM
  if (input.includes(":")) {
    const [hStr, mStr] = input.split(":");
    const hours = parseInt(hStr, 10) || 0;
    const mins = parseInt(mStr, 10) || 0;
    return hours * 60 + mins;
  }
  // If format is a decimal number (e.g. "3.5" hours)
  if (input.includes(".")) {
    const hoursFloat = parseFloat(input);
    if (isNaN(hoursFloat))
      throw new Error("Invalid numeric format for goal time.");
    return Math.round(hoursFloat * 60);
  }
  // If format is an integer (assume it's hours unless it's a large number of minutes)
  const num = parseInt(input, 10);
  if (isNaN(num)) throw new Error("Invalid goal time format.");
  if (num >= 60) {
    // If 60 or above with no colon or dot, assume it's minutes (e.g. "360" -> 360 minutes)
    return num;
  } else {
    // Otherwise treat as hours
    return num * 60;
  }
}

// Fetch environment variables for Toggl credentials and workspace IDs
const apiToken = process.env.TOGGL_API_TOKEN;
if (!apiToken) {
  console.error("Error: TOGGL_API_TOKEN environment variable not set.");
  process.exit(1);
}
const workspaceIDs: number[] = [];
if (TOGGL_WORKSPACE_ID) {
  workspaceIDs.push(Number(TOGGL_WORKSPACE_ID));
}
if (TOGGL_LP_WORKSPACE_ID) {
  workspaceIDs.push(Number(TOGGL_LP_WORKSPACE_ID));
}

// Basic auth header (API token as username, 'api_token' as password)
const authHeader =
  "Basic " + Buffer.from(`${apiToken}:api_token`).toString("base64");

// Determine start and end of today in ISO (using local timezone)
function getTodayDateRange(): { start: string; end: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  // Start of today at local midnight
  const startLocal = new Date(year, month, day, 0, 0, 0);
  // Start of tomorrow at local midnight (end boundary)
  const endLocal = new Date(year, month, day + 1, 0, 0, 0);
  return {
    start: startLocal.toISOString(),
    end: endLocal.toISOString(),
  };
}

// Fetch all time entries for today from Toggl (across all workspaces accessible by the API token)
async function fetchTodayEntries() {
  const { start, end } = getTodayDateRange();
  const url = `https://api.track.toggl.com/api/v9/me/time_entries?start_date=${encodeURIComponent(
    start,
  )}&end_date=${encodeURIComponent(end)}`;
  const response = await fetch(url, {
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Toggl API request failed with status ${response.status}`);
  }
  const data = await response.json();
  // The API returns an object with "items" array
  const entries: any[] = Array.isArray(data) ? data : (data as any).items || [];
  return entries;
}

// Main monitoring function
async function checkDailyTotal(goalSeconds: number, goalMinutes: number) {
  try {
    const entries = await fetchTodayEntries();
    let totalSeconds = 0;
    const nowTime = Date.now();

    for (const entry of entries) {
      // If workspace filter is set, skip entries not in our target workspaces
      if (workspaceIDs.length && !workspaceIDs.includes(entry.workspace_id)) {
        continue;
      }
      if (entry.duration < 0) {
        // Running entry: duration is negative (usually -1), calculate elapsed time from start until now
        const startTime = new Date(entry.start).getTime();
        const elapsed = nowTime - startTime;
        if (elapsed > 0) {
          totalSeconds += Math.floor(elapsed / 1000);
        }
      } else {
        // Finished entry: add its duration (Toggl API duration is in seconds)
        totalSeconds += entry.duration;
      }
    }

    // Check if goal reached
    if (totalSeconds >= goalSeconds) {
      // Format goal for message (e.g. "6h 0m" or "3h 30m")
      const goalH = Math.floor(goalMinutes / 60);
      const goalM = goalMinutes % 60;
      const goalDisplay = goalM ? `${goalH}h ${goalM}m` : `${goalH}h`;
      // Send macOS notification
      const script = `display notification "You have reached your daily goal of ${goalDisplay}!" with title "Toggl Goal Met"`;
      exec(`osascript -e '${script}'`);
      const totalH = Math.floor(totalSeconds / 3600);
      const totalM = Math.floor((totalSeconds % 3600) / 60);
      const totalDisplay = `${totalH}h ${totalM}m`;
      console.log(`✅ Goal reached! You have tracked ${totalDisplay} today.`);
      return true; // indicate goal reached
    } else {
      // Log current progress with progress bar
      const currH = Math.floor(totalSeconds / 3600);
      const currM = Math.floor((totalSeconds % 3600) / 60);
      const goalH = Math.floor(goalMinutes / 60);
      const goalM = goalMinutes % 60;
      const currentDisplay = `${currH}:${currM.toString().padStart(2, "0")}`;
      const goalDisplay = `${goalH}:${goalM.toString().padStart(2, "0")}`;

      // Create progress bars
      const progressPercent = Math.min(100, (totalSeconds / goalSeconds) * 100);

      // Progress bar for command line (60 chars)
      const consoleBarLength = 60;
      const filledLength = Math.floor(
        (progressPercent / 100) * consoleBarLength,
      );
      const emptyLength = consoleBarLength - filledLength;
      const progressBar = "█".repeat(filledLength) + "░".repeat(emptyLength);

      // Calculate remaining time
      const remainingSeconds = Math.max(0, goalSeconds - totalSeconds);
      const remainingH = Math.floor(remainingSeconds / 3600);
      const remainingM = Math.floor((remainingSeconds % 3600) / 60);
      const remainingDisplay = `${remainingH}:${remainingM
        .toString()
        .padStart(2, "0")}`;

      // Progress bar for window title (10 chars, ASCII chars for better spacing)
      const titleBarLength = 10;
      const titleFilledLength = Math.floor(
        (progressPercent / 100) * titleBarLength,
      );
      const titleEmptyLength = titleBarLength - titleFilledLength;
      const titleProgressBar =
        "█".repeat(titleFilledLength) + "▒".repeat(titleEmptyLength);

      // Update window title
      process.stdout.write(
        `\x1b]0;(-${remainingDisplay}) [${titleProgressBar}]\x07`,
      );

      const output = `[${new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}] (${remainingDisplay} remaining) [${progressBar}] ${progressPercent.toFixed(
        1,
      )}%`;

      // Use \r to return to start of line and overwrite
      process.stdout.write("\r" + output);
      return false; // goal not yet reached
    }
  } catch (err: any) {
    console.error("Error fetching Toggl data:", err.message || err);
    // If unauthorized (HTTP 401/403), exit the process to avoid looping indefinitely
    if (
      err.message &&
      (err.message.includes("401") || err.message.includes("403"))
    ) {
      console.error(
        "❌ Authentication failed. Please check your Toggl API token.",
      );
      process.exit(1);
    }
    // Otherwise (network error, 5xx error), just log and continue to next interval
    return false;
  }
}

// Main function
async function main() {
  // Read goal from command-line argument
  const goalInput = process.argv[2];
  if (!goalInput) {
    console.error(
      "Usage: bun run index.ts <daily_goal_time>\nExample: bun run index.ts 6:00",
    );
    process.exit(1);
  }
  
  let goalMinutes: number;
  try {
    goalMinutes = parseGoalTime(goalInput);
  } catch (e: any) {
    console.error("❌ Could not parse goal time:", e.message);
    process.exit(1);
  }
  
  const goalSeconds = goalMinutes * 60;
  // Format goal display for initial message
  const goalH = Math.floor(goalMinutes / 60);
  const goalM = goalMinutes % 60;
  const goalDisplay = `${goalH}:${goalM.toString().padStart(2, "0")}`;

  console.log(`🎯 Goal: ${goalDisplay}`);

  // Perform an initial check immediately, then schedule recurring checks
  const reached = await checkDailyTotal(goalSeconds, goalMinutes);
  if (reached) {
    process.exit(0);
  }
  
  const interval = setInterval(async () => {
    const reached = await checkDailyTotal(goalSeconds, goalMinutes);
    if (reached) {
      clearInterval(interval);
      process.exit(0);
    }
  }, 30000);
}

// Run main function
main().catch(console.error);
