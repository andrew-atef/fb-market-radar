// Verification script: extracts DASHBOARD_HTML_CSS from dashboard.ts,
// then syntax-checks the generated <script> block just like a browser would.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync("src/services/dashboard.ts", "utf8");

// Grab the giant string-concatenation expression
const m = src.match(/const DASHBOARD_HTML_CSS =([\s\S]*?);\s*\n\s*\/\*\*/);
if (!m) {
  console.error("Could not locate DASHBOARD_HTML_CSS block");
  process.exit(1);
}

let html;
try {
  html = eval("(" + m[1] + ")"); // pure string concatenation — safe to eval
} catch (e) {
  console.error("Failed to evaluate string concat:", e);
  process.exit(1);
}

console.log("HTML length:", html.length);

// Extract the <script> block
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) {
  console.error("No <script> block found!");
  process.exit(1);
}

const js = scriptMatch[1];
try {
  new vm.Script(js); // throws on syntax error, same as browser parser
  console.log("✅ Dashboard <script> syntax is VALID");
} catch (e) {
  console.error("❌ Dashboard <script> SYNTAX ERROR:", e.message);
  // Show the offending line for debugging
  const lineInfo = e.stack.match(/<anonymous>:(\d+)/);
  if (lineInfo) {
    const lineNo = parseInt(lineInfo[1], 10) - 2; // vm.Script wrapper offset
    const lines = js.split("\n");
    console.error("Near line", lineNo, ":", lines[lineNo - 2] ?? "");
    console.error(">>>", lines[lineNo - 1] ?? "");
  }
  process.exit(1);
}

// Sanity: ensure no stray unescaped backslash-quote sequences remain
const bad = html.match(/\\>/g);
console.log(bad ? "⚠️ Found \\> sequences: " + bad.length : "✅ No stray \\> sequences");

// Also verify the paired quotes pattern on the previously broken line
const titleLine = js.split("\n").find(l => l.includes("title-cell"));
console.log("Generated title line:");
console.log("   ", titleLine);
