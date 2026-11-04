const mod = await import("./index.ts");
const p = process.argv[2];
const commands = [{ name: "skill:demo-skill", source: "skill", description: "demo", sourceInfo: { path: p, baseDir: "/tmp" } }];
for (const text of [
  "请使用 /skill:demo-skill 处理",
  "先用别的，请用/skill:demo-skill处理",
  "/skill:demo-skill 和 $demo-skill 都写",
  "行一\n/skill:demo-skill",
]) {
  const found = mod.collectSkillInvocations(text, commands);
  console.log(JSON.stringify(text).padEnd(30), "→", found.length ? found.map((s) => s.name).join(",") : "—");
}
