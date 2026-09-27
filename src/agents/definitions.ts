export interface AgentDefinition {
  name: string;
  description: string;
  systemPrompt: string;
  tools?: string[];
  spawns?: string;
  model?: string;
}

const AGENTS: Record<string, AgentDefinition> = {
  task: {
    name: "task",
    description: "General subagent",
    systemPrompt: "You are a general-purpose subagent. Complete the assigned task.",
    model: "@default",
    spawns: "*",
  },
  sonic: {
    name: "sonic",
    description: "Mechanical edits",
    systemPrompt: "You perform mechanical file edits quickly and precisely.",
    model: "@smol",
    tools: ["write", "edit", "bash"],
  },
  scout: {
    name: "scout",
    description: "Read-only reconnaissance",
    systemPrompt: "You gather information. Never modify files.",
    model: "@smol",
    tools: ["read"],
  },
  reviewer: {
    name: "reviewer",
    description: "Read-only code review",
    systemPrompt: "You review code. Never modify files.",
    model: "@default",
    tools: ["read"],
  },
};

export function getAgent(name: string): AgentDefinition {
  const a = AGENTS[name];
  if (!a) throw new Error(`unknown agent "${name}"`);
  return a;
}

export const READ_ONLY_TOOLS: Record<string, true> = { read: true };

export function isReadOnly(name: string): boolean {
  const a = getAgent(name);
  if (!a.tools) return false;
  return a.tools.every((t) => READ_ONLY_TOOLS[t]);
}

export function filterToolsForAgent(agent: AgentDefinition, toolNames: string[]): string[] {
  if (!agent.tools) return toolNames.slice();
  const allowed: Record<string, true> = {};
  for (const t of agent.tools) allowed[t] = true;
  return toolNames.filter((t) => allowed[t]);
}
