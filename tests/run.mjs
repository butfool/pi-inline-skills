import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const sdkEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const tuiEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-tui"));
const extensionEntry = fileURLToPath(new URL("../index.ts", import.meta.url));
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { "@earendil-works/pi-coding-agent": sdkEntry, "@earendil-works/pi-tui": tuiEntry },
});
const extension = await jiti.import("../index.ts");
const sdk = await import(sdkEntry);
const tui = await import(tuiEntry);

const root = mkdtempSync(join(tmpdir(), "pi-inline-skills-"));
const agentDir = join(root, "agent");
const cwd = join(root, "project");
const skillsRoot = join(root, "skills");
mkdirSync(agentDir, { recursive: true });
mkdirSync(cwd, { recursive: true });

function writeSkill(name, description, body) {
  const dir = join(skillsRoot, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`);
  return dir;
}

const findDocsDir = writeSkill("find-docs", "Retrieves up-to-date documentation.", "# Find docs\n\nRead references/intro.md first.");
writeSkill("simplify", "Review changed code for clarity.", "# Simplify\n\nKeep behaviour unchanged.");
writeSkill("iwhale-open-api", "Query the open api catalog.", "# Open API\n\nLook up the catalog.");

let checks = 0;
function check(condition) {
  assert(condition);
  checks++;
}

const settingsManager = sdk.SettingsManager.inMemory();
const resourceLoader = new sdk.DefaultResourceLoader({
  cwd,
  agentDir,
  settingsManager,
  noExtensions: true,
  noSkills: true,
  noContextFiles: true,
  additionalSkillPaths: [skillsRoot],
  extensionFactories: [extension.default],
});
await resourceLoader.reload();
check(resourceLoader.getExtensions().errors.length === 0);

const commands = resourceLoader.getSkills().skills.map((skill) => ({
  name: `skill:${skill.name}`,
  description: skill.description,
  source: "skill",
  sourceInfo: skill.sourceInfo,
}));
check(commands.some((command) => command.name === "skill:find-docs"));

try {
  const names = (text) => extension.collectSkillInvocations(text, commands).map((skill) => skill.name);

  check(names("$find-docs").join() === "find-docs");
  check(names("请使用 $find-docs 查询文档").join() === "find-docs");
  check(names("请使用$find-docs，查询文档").join() === "find-docs");
  check(names("请使用/skill:find-docs，查询文档").join() === "find-docs");
  check(names("第一行\n请使用 $find-docs").join() === "find-docs");

  // Pi expands a leading `/skill:` command itself.
  check(names("/skill:find-docs 查询文档").length === 0);
  check(names("  /skill:find-docs 查询文档").join() === "find-docs");
  check(names("/skill:find-docs 和 $find-docs").length === 0);

  for (const literal of [
    "$PATH",
    "$9.99",
    "$unknown-skill",
    "$find-docsX",
    "$find-docs_extra",
    "$find-docs.md",
    "\\$find-docs",
    "foo$find-docs",
    "https://example.com/skill:find-docs",
  ]) {
    check(names(literal).length === 0);
  }

  check(names("$simplify 再看 $find-docs 和 $simplify").join() === "simplify,find-docs");

  const [findDocs] = extension.collectSkillInvocations("$find-docs", commands);
  const block = extension.buildSkillBlock(findDocs);
  check(block.startsWith(`<skill name="find-docs" location="${join(findDocsDir, "SKILL.md")}">`));
  check(block.includes(`References are relative to ${findDocsDir}.`));
  check(!block.includes("---\nname: find-docs"));
  check(block.includes("Read references/intro.md first."));
  check(block.endsWith("</skill>"));
  const parsed = sdk.parseSkillBlock(block);
  check(parsed !== null && parsed.name === "find-docs");
  check(parsed.location === join(findDocsDir, "SKILL.md"));

  // The block is byte-identical to what Pi builds for `/skill:name`.
  const { session } = await sdk.createAgentSession({
    cwd,
    agentDir,
    resourceLoader,
    settingsManager,
    sessionManager: sdk.SessionManager.inMemory(cwd),
  });
  await session.bindExtensions({ mode: "print" });

  const provider = extension.createSkillProvider(
    new tui.CombinedAutocompleteProvider([], cwd),
    () => new Map(extension.collectSkillInvocations("$find-docs $simplify $iwhale-open-api", commands).map((skill) => [skill.name, skill])),
  );
  const suggest = (text) => provider.getSuggestions([text], 0, text.length, { signal: new AbortController().signal });

  const dollar = await suggest("请使用 $doc");
  check(dollar !== null && dollar.prefix === "$doc");
  check(dollar.items.some((item) => item.value === "$find-docs"));

  const slash = await suggest("请使用 /skill:doc");
  check(slash !== null && slash.prefix === "/skill:doc");
  check(slash.items.some((item) => item.value === "/skill:find-docs"));

  const fuzzy = await suggest("请使用 $open");
  check(fuzzy !== null && fuzzy.items[0].value === "$iwhale-open-api");

  check((await suggest("请使用 find-do")) === null);
  check((await suggest("请使用 $nope-not-a-skill")) === null);

  check(provider.shouldTriggerFileCompletion(["请使用 $doc"], 0, 8) === false);
  check(provider.shouldTriggerFileCompletion(["请使用 @src"], 0, 8) === true);

  const applied = provider.applyCompletion(["使用 $doc，继续"], 0, 7, { value: "$find-docs", label: "find-docs" }, "$doc");
  check(applied.lines[0] === "使用 $find-docs ，继续");
  check(applied.cursorCol === "使用 $find-docs ".length);
  const gluedApplied = provider.applyCompletion(["请使用$doc"], 0, 7, { value: "$find-docs", label: "find-docs" }, "$doc");
  check(gluedApplied.lines[0] === "请使用$find-docs ");

  sdk.initTheme("dark", false);
  const renderer = session.extensionRunner.getMessageRenderer(extension.MESSAGE_TYPE);
  check(typeof renderer === "function");
  const component = renderer({ content: block, customType: extension.MESSAGE_TYPE }, { expanded: false, outputPad: 1 });
  check(component instanceof sdk.SkillInvocationMessageComponent);

  const entries = () => session.sessionManager.getBranch();
  const customMessages = () => entries().filter((entry) => entry.type === "custom_message");

  const first = await session.extensionRunner.emitInput("请使用$find-docs，然后继续", undefined, "rpc", undefined);
  check(first.action === "continue");
  const customs = customMessages();
  check(customs.length === 1);
  check(customs[0].customType === extension.MESSAGE_TYPE);
  check(customs[0].display === true);
  check(String(customs[0].content) === block);

  const leading = await session.extensionRunner.emitInput("/skill:find-docs 处理一下", undefined, "rpc", undefined);
  check(leading.action === "continue");
  check(customMessages().length === 1);

  const multiple = await session.extensionRunner.emitInput("$simplify 和 $find-docs 一起", undefined, "rpc", undefined);
  check(multiple.action === "continue");
  const afterMultiple = customMessages();
  check(afterMultiple.length === 3);
  check(afterMultiple.slice(-2).map((entry) => entry.details.name).join() === "simplify,find-docs");

  session.dispose();

  const fileLoader = new sdk.DefaultResourceLoader({
    cwd, agentDir, settingsManager,
    additionalExtensionPaths: [extensionEntry],
    noContextFiles: true,
  });
  await fileLoader.reload();
  check(fileLoader.getExtensions().errors.length === 0);
  check(fileLoader.getExtensions().extensions.some((item) => item.path === extensionEntry));

  const packageLoader = new sdk.DefaultResourceLoader({
    cwd, agentDir,
    settingsManager: sdk.SettingsManager.inMemory({ packages: [fileURLToPath(new URL("..", import.meta.url))] }),
    noContextFiles: true,
  });
  await packageLoader.reload();
  check(packageLoader.getExtensions().errors.length === 0);
  check(packageLoader.getExtensions().extensions.filter((item) => item.path === extensionEntry).length === 1);

  console.log(`Passed ${checks} assertions against real skills, the real Pi provider, and a real session.`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
