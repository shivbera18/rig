import { runSubagent } from "../subagents/subagent.js";

// wired into builtinTools() by turn slice when present — import here is
// optional, no cycle: task.ts imports only subagent.ts.

export interface TaskToolArgs {
  assignment: string;
  agent?: string;
}

export const taskTool = {
  name: "task",
  description: "Spawn a subagent to do work in an isolated git worktree, then merge its patch.",
  schema: {
    type: "object",
    required: ["assignment"],
    properties: {
      assignment: { type: "string" },
      agent: { type: "string" },
    },
  },
  async execute(args: TaskToolArgs): Promise<string> {
    return runSubagent({
      assignment: args.assignment,
      ...(args.agent === undefined ? {} : { agent: args.agent }),
      isolation: { enabled: true, merge: "patch" },
    });
  }
};
