import { writeFileSync } from "node:fs";

const mode = process.argv[2];
if (mode === "echo") {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  process.stdout.write(Buffer.concat(chunks));
} else if (mode === "error") {
  process.stderr.write("private-adapter-diagnostic");
  process.exit(7);
} else if (mode === "stdout-limit") {
  process.stdout.write("x".repeat(17 * 1024 * 1024));
} else if (mode === "stderr-limit") {
  process.stderr.write("x".repeat(300 * 1024));
} else if (mode === "hang") {
  writeFileSync(process.argv[3]!, String(process.pid));
  setInterval(() => {}, 1000);
}
