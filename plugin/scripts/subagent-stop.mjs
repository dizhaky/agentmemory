#!/usr/bin/env node
import { execFile } from "node:child_process";
import { basename } from "node:path";
//#region src/hooks/_project.ts
const DEFAULT_PROJECT_RESOLVE_TIMEOUT_MS = 3e3;
async function resolveProject(cwd, timeoutMs = DEFAULT_PROJECT_RESOLVE_TIMEOUT_MS) {
	const explicit = process.env["AGENTMEMORY_PROJECT_NAME"];
	if (explicit && explicit.trim()) return explicit.trim();
	const dir = cwd && cwd.trim() ? cwd : process.cwd();
	return new Promise((resolve) => {
		execFile("git", ["rev-parse", "--show-toplevel"], {
			cwd: dir,
			encoding: "utf8",
			maxBuffer: 4096,
			timeout: timeoutMs,
			windowsHide: true
		}, (error, stdout) => {
			const toplevel = stdout.trim();
			resolve(!error && toplevel ? basename(toplevel) : basename(dir));
		});
	});
}
//#endregion
//#region src/hooks/subagent-stop.ts
function isSdkChildContext(payload) {
	if (process.env["AGENTMEMORY_SDK_CHILD"] === "1") return true;
	if (!payload || typeof payload !== "object") return false;
	return payload.entrypoint === "sdk-ts";
}
const REST_URL = process.env["AGENTMEMORY_URL"] || "http://localhost:3111";
const SECRET = process.env["AGENTMEMORY_SECRET"] || "";
function authHeaders() {
	const h = { "Content-Type": "application/json" };
	if (SECRET) h["Authorization"] = `Bearer ${SECRET}`;
	return h;
}
async function main() {
	let input = "";
	for await (const chunk of process.stdin) input += chunk;
	let data;
	try {
		data = JSON.parse(input);
	} catch {
		return;
	}
	if (!data || typeof data !== "object") return;
	if (isSdkChildContext(data)) return;
	const sessionId = data.session_id || data.sessionId || "unknown";
	const agentId = data.agent_id || data.agentName;
	const agentType = data.agent_type || data.agentDisplayName || data.agentName;
	const lastMsg = typeof data.last_assistant_message === "string" ? data.last_assistant_message.slice(0, 4e3) : "";
	fetch(`${REST_URL}/agentmemory/observe`, {
		method: "POST",
		headers: authHeaders(),
		body: JSON.stringify({
			hookType: "subagent_stop",
			sessionId,
			project: await resolveProject(data.cwd, 500),
			cwd: data.cwd || process.cwd(),
			timestamp: (/* @__PURE__ */ new Date()).toISOString(),
			data: {
				agent_id: agentId,
				agent_type: agentType,
				last_message: lastMsg
			}
		}),
		signal: AbortSignal.timeout(2e3)
	}).catch(() => {});
	setTimeout(() => process.exit(0), 500).unref();
}
main().catch(() => process.exit(0));
//#endregion
export {};

//# sourceMappingURL=subagent-stop.mjs.map