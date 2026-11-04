const mod = await import("./index.ts");
const p = process.argv[2];
const commands = [{ name: "skill:demo-skill", source: "skill", description: "demo", sourceInfo: { path: p, baseDir: "/tmp" } }];
for (const text of [
  "$demo-skill ok",
  "请使用$demo-skill，继续",
  "/skill:demo-skill 行内",
  "/skill:demo-skill",
  "  /skill:demo-skill 行首带空格",
  "\\$demo-skill 转义",
  "$demo-skillX 尾字母",
  "$demo-skill_extra 尾下划线",
  "$demo-skill-2 尾数字",
  "$PATH $9.99 $unknown",
  "/tmp/$demo-skill 路径",
  "foo$demo-skill 标识符尾巴",
]) {
  const found = mod.collectSkillInvocations(text, commands);
  console.log(JSON.stringify(text).padEnd(34), "→", found.length ? found.map((s) => s.name).join(",") : "—");
}
