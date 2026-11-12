#!/usr/bin/env node
/**
 * CI diagnose: one command that prints a workflow run's conclusion, every job's conclusion, and the failing
 * test lines pulled from the job logs through the GitHub REST API.
 *
 * Given a run id (--run-id) or a commit (--sha), it prints the run, each job, and the failing lines of each job.
 * Logs that are absent or expired (HTTP 404 or 410) are reported EXPLICITLY as unavailable, never as "no failures".
 *
 * Usage:
 *   node scripts/ci-diagnose.mjs --run-id 123456
 *   node scripts/ci-diagnose.mjs --sha abc1234 [--repo owner/name]
 *
 * Env: GH_TOKEN or GITHUB_TOKEN (Bearer token). The script calls the API with fetch only, never through the gh CLI.
 *
 * Exit codes: 0 after a report (whatever the diagnosed run's result), 1 on a script-level failure (usage, missing
 * token, bad argument, network or unparseable response). Node port of the source script: same flags, output and
 * exit codes; the pure functions are exported for unit tests and the fetch and git wrappers are not tested.
 */

import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const isObject = (v) => typeof v === 'object' && v !== null;

// Pure. Parses `git remote get-url origin` output into { owner, repo } for https and ssh github remotes.
export function parseRepoFromRemoteUrl(url) {
  const trimmed = url.trim();
  if (trimmed.length === 0) return { error: 'empty remote url' };
  const https = trimmed.match(/^https?:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (https) return { owner: https[1], repo: https[2] };
  const ssh = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  return { error: `could not parse owner/repo from remote url: ${trimmed}` };
}

// Pure. Reads status, head_sha and conclusion from a run response. An in-progress run (conclusion null) is valid.
export function parseRunResponse(json) {
  if (!isObject(json)) return { error: 'run response is not an object' };
  if (typeof json.status !== 'string') return { error: "run response missing string 'status' field" };
  if (typeof json.head_sha !== 'string' || json.head_sha.length === 0) {
    return { error: "run response missing string 'head_sha' field" };
  }
  if (json.conclusion !== null && typeof json.conclusion !== 'string') {
    return { error: "run response 'conclusion' field is neither string nor null" };
  }
  return { conclusion: json.conclusion, status: json.status, headSha: json.head_sha };
}

// Pure. Returns { name, conclusion, id } for each well-formed job; [] for a missing or empty jobs array.
export function parseJobsResponse(json) {
  if (!isObject(json) || !Array.isArray(json.jobs)) return [];
  const jobs = [];
  for (const entry of json.jobs) {
    if (!isObject(entry)) continue;
    if (typeof entry.name !== 'string') continue;
    if (typeof entry.id !== 'number') continue;
    if (entry.conclusion !== null && typeof entry.conclusion !== 'string') continue;
    jobs.push({ name: entry.name, conclusion: entry.conclusion ?? null, id: entry.id });
  }
  return jobs;
}

// Pure. Lines that look like test failure markers: start with FAILED, contain "error: ", or contain AssertionError.
export function extractFailingTestLines(logText) {
  return logText.split('\n').filter(
    (line) => line.startsWith('FAILED') || line.includes('error: ') || line.includes('AssertionError'),
  );
}

// Pure. Maps the HTTP status of a job-log request to an explicit availability value.
export function classifyLogsAvailability(httpStatus) {
  if (httpStatus === 200) return { available: true };
  if (httpStatus === 410) return { available: false, reason: 'expired', httpStatus };
  if (httpStatus === 404) return { available: false, reason: 'not_found', httpStatus };
  return { available: false, reason: 'other', httpStatus };
}

// Pure. The first entry of the runs list is the newest matching run. An empty list is { error }.
export function resolveRunIdFromSha(runsListJson) {
  if (!isObject(runsListJson)) return { error: 'runs list response is not an object' };
  if (!Array.isArray(runsListJson.workflow_runs) || runsListJson.workflow_runs.length === 0) {
    return { error: 'no runs found for sha' };
  }
  const first = runsListJson.workflow_runs[0];
  if (!isObject(first) || typeof first.id !== 'number') return { error: 'no runs found for sha' };
  return first.id;
}

// Pure. One entry per job: either failingLines (possibly []) or logsUnavailable. The two are structurally distinct.
export function buildDiagnosisReport(run, jobs, jobLogResults) {
  const jobDiagnoses = jobs.map((job) => {
    const logResult = jobLogResults.get(job.id);
    if (logResult === undefined || !logResult.availability.available) {
      const unavailable = logResult !== undefined && !logResult.availability.available;
      return {
        name: job.name,
        conclusion: job.conclusion,
        logsUnavailable: {
          reason: unavailable ? logResult.availability.reason : 'not_found',
          httpStatus: unavailable ? logResult.availability.httpStatus : 404,
        },
      };
    }
    return {
      name: job.name,
      conclusion: job.conclusion,
      failingLines: extractFailingTestLines(logResult.logText),
    };
  });
  return { runConclusion: run.conclusion, runStatus: run.status, jobs: jobDiagnoses };
}

// Impure: GitHub REST calls and the git remote read. Not unit tested.
const GITHUB_API_BASE = 'https://api.github.com';

const authHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
});

async function getJson(url, token) {
  const res = await fetch(url, { headers: authHeaders(token) });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

export const fetchRun = (owner, repo, runId, token) =>
  getJson(`${GITHUB_API_BASE}/repos/${owner}/${repo}/actions/runs/${runId}`, token);

export const fetchJobs = (owner, repo, runId, token) =>
  getJson(`${GITHUB_API_BASE}/repos/${owner}/${repo}/actions/runs/${runId}/jobs`, token);

export const fetchRunsBySha = (owner, repo, sha, token) =>
  getJson(`${GITHUB_API_BASE}/repos/${owner}/${repo}/actions/runs?head_sha=${sha}`, token);

export async function fetchJobLogs(owner, repo, jobId, token) {
  const res = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`, {
    headers: authHeaders(token),
  });
  const text = res.status === 200 ? await res.text() : '';
  return { status: res.status, text };
}

export function runGitRemote() {
  const r = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return r.error || r.status !== 0 ? '' : (r.stdout ?? '').trim();
}

// CLI wiring
export function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--run-id') result.runId = args[++i];
    else if (args[i] === '--sha') result.sha = args[++i];
    else if (args[i] === '--repo') result.repo = args[++i];
  }
  return result;
}

const printUsage = () => console.log('Usage: ci-diagnose.mjs (--run-id <id> | --sha <sha>) [--repo owner/name]');

function printReport(report) {
  console.log('\n=== CI Diagnosis ===');
  console.log(`Run status: ${report.runStatus}`);
  console.log(`Run conclusion: ${report.runConclusion ?? '(in progress)'}\n`);
  for (const job of report.jobs) {
    console.log(`Job: ${job.name}`);
    console.log(`  Conclusion: ${job.conclusion ?? '(in progress)'}`);
    if ('logsUnavailable' in job) {
      console.log(
        `  Logs UNAVAILABLE (${job.logsUnavailable.reason}, HTTP ${job.logsUnavailable.httpStatus}) — cannot report failing lines`,
      );
    } else if (job.failingLines.length === 0) {
      console.log('  No failing test lines found in logs.');
    } else {
      console.log('  Failing test lines:');
      for (const line of job.failingLines) console.log(`    ${line}`);
    }
    console.log('');
  }
}

// Resolves the owner and repo: --repo wins, else the origin remote. Returns { owner, repo } or { error }.
function resolveRepo(args) {
  if (args.repo) {
    const parts = args.repo.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return { error: `--repo must be in the form owner/name, got: ${args.repo}` };
    }
    return { owner: parts[0], repo: parts[1] };
  }
  const parsed = parseRepoFromRemoteUrl(runGitRemote());
  if ('error' in parsed) return { error: `${parsed.error} — pass --repo owner/name explicitly.` };
  return parsed;
}

// Returns the exit code. Each refusal prints one [ci-diagnose] line and returns 1 before any network call that follows it.
export async function main(argv, env) {
  const args = parseArgs(argv);
  if (!args.runId && !args.sha) {
    printUsage();
    return 1;
  }
  const token = env.GH_TOKEN ?? env.GITHUB_TOKEN;
  if (!token) {
    console.error('[ci-diagnose] Missing GH_TOKEN or GITHUB_TOKEN env var — cannot authenticate to the GitHub REST API.');
    return 1;
  }
  const target = resolveRepo(args);
  if ('error' in target) {
    console.error(`[ci-diagnose] ${target.error}`);
    return 1;
  }
  const { owner, repo } = target;

  let runId;
  if (args.sha) {
    const listed = await fetchRunsBySha(owner, repo, args.sha, token);
    if (listed.status !== 200) {
      console.error(`[ci-diagnose] Failed to list runs for sha ${args.sha}: HTTP ${listed.status}`);
      return 1;
    }
    const resolved = resolveRunIdFromSha(listed.json);
    if (typeof resolved !== 'number') {
      console.error(`[ci-diagnose] ${resolved.error}`);
      return 1;
    }
    runId = resolved;
  } else {
    const parsedRunId = Number(args.runId);
    if (!Number.isInteger(parsedRunId) || parsedRunId <= 0) {
      console.error(`[ci-diagnose] --run-id must be a positive integer, got: ${args.runId}`);
      return 1;
    }
    runId = parsedRunId;
  }

  const runResult = await fetchRun(owner, repo, runId, token);
  if (runResult.status !== 200) {
    console.error(`[ci-diagnose] Failed to fetch run ${runId}: HTTP ${runResult.status}`);
    return 1;
  }
  const run = parseRunResponse(runResult.json);
  if ('error' in run) {
    console.error(`[ci-diagnose] ${run.error}`);
    return 1;
  }

  const jobsResult = await fetchJobs(owner, repo, runId, token);
  if (jobsResult.status !== 200) {
    console.error(`[ci-diagnose] Failed to fetch jobs for run ${runId}: HTTP ${jobsResult.status}`);
    return 1;
  }
  const jobs = parseJobsResponse(jobsResult.json);

  const jobLogResults = new Map();
  for (const job of jobs) {
    const logs = await fetchJobLogs(owner, repo, job.id, token);
    jobLogResults.set(job.id, { availability: classifyLogsAvailability(logs.status), logText: logs.text });
  }

  printReport(buildDiagnosisReport(run, jobs, jobLogResults));
  return 0;
}

// Runs main only when this file is the entry point, comparing real paths (a symlinked path must still run).
const isEntry = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isEntry) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
