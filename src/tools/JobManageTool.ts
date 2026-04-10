import { z } from 'zod';
import { registerTool } from '../Tool.ts';
import { JobManager } from '../core/JobManager.ts';

export const JobManageTool = registerTool({
  name: 'job_manage',
  description: 'Manage background bash properties spawned via bash tool with is_background=true. Use this to read active server logs, send stdin to interactive prompts, or kill runaway processes.',
  authType: 'requires_confirm',
  isReadOnly: false,
  inputSchema: z.object({
    action: z.enum(['list', 'logs', 'input', 'kill']).describe('The manager action to perform.'),
    jobId: z.string().optional().describe('The ID of the background job. Required for logs, input, and kill.'),
    text: z.string().optional().describe('The exact text to feed to the job standard input. Required for input.'),
    lines: z.number().optional().describe('Number of recent log lines to retrieve (default 200, max 1000).'),
  }),

  async call(args, _context) {
    const { action, jobId, text, lines } = args;
    const manager = JobManager.getInstance();

    switch (action) {
      case 'list': {
        const jobs = manager.getJobs();
        if (jobs.length === 0) return { output: '[No background jobs are currently tracked]' };
        const output = jobs.map(j => 
          `- [jobId: ${j.jobId}] PID: ${j.pid || 'N/A'} | Status: ${j.status.toUpperCase()} | Command: ${j.command}`
        ).join('\n');
        return { output: `[BACKGROUND JOBS]\n${output}` };
      }

      case 'logs': {
        if (!jobId) return { output: 'Error: jobId required.', isError: true };
        const logData = manager.getJobLogs(jobId, lines || 200);
        if (logData === null) return { output: `Error: Job ${jobId} not found.`, isError: true };
        return { output: `[LOGS FOR JOB ${jobId}]\n${logData}` };
      }

      case 'input': {
        if (!jobId || !text) return { output: 'Error: jobId and text required.', isError: true };
        const success = manager.writeStdin(jobId, text);
        return { output: success ? `[STDOUT] Successfully wrote to job ${jobId} stdin.` : `Error: Job ${jobId} is not running or not found.`, isError: !success };
      }

      case 'kill': {
        if (!jobId) return { output: 'Error: jobId required.', isError: true };
        const success = manager.killJob(jobId);
        return { output: success ? `[SIGNAL] Sent SIGTERM to job ${jobId}.` : `Error: Job ${jobId} is not running or not found.`, isError: !success };
      }

      default:
        return { output: `Error: Unknown action ${action}`, isError: true };
    }
  }
});
