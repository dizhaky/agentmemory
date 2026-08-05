import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Reasoning models on OpenRouter (DeepSeek V4/R1, etc.) return the final
// answer in message.content but, when reasoning exhausts the token budget
// (finish_reason:"length"), content is null and only reasoning /
// reasoning_details are populated. Fall back so mem::summarize chunk calls
// do not hard-fail with empty_provider_response. The reasoning text is
// degraded (truncated) in the length case, but the chunk+reduce layer
// tolerates partial output better than a hard throw.
const dir = "/opt/agentmemory/node_modules/@agentmemory/agentmemory/dist";
const old =
  "const content = data.choices?.[0]?.message?.content;\n" +
  "\t\tif (!content) throw new Error(`${this.name} returned unexpected response";
const replacement =
  "const _msg = data.choices?.[0]?.message;\n" +
  "\t\tlet content = _msg?.content;\n" +
  "\t\tif (!content) { const _rd = _msg?.reasoning_details; content = (Array.isArray(_rd) ? _rd.find(d => d && d.text)?.text : undefined) ?? _msg?.reasoning; }\n" +
  "\t\tif (!content) throw new Error(`${this.name} returned unexpected response";

let patched = 0;
for (const f of readdirSync(dir)) {
  if (!f.endsWith(".mjs")) continue;
  const p = join(dir, f);
  const s = readFileSync(p, "utf8");
  if (!s.includes(old)) continue;
  writeFileSync(p, s.replace(old, replacement));
  console.log("openrouter-reasoning-patch: patched", p);
  patched++;
}
if (patched === 0) {
  console.error("openrouter-reasoning-patch: PATTERN NOT FOUND — aborting build");
  process.exit(1);
}
console.log("openrouter-reasoning-patch: " + patched + " file(s) patched");
