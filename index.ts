import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  getMarkdownTheme,
  parseSkillBlock,
  SkillInvocationMessageComponent,
  stripFrontmatter,
  type ExtensionAPI,
  type SlashCommandInfo,
} from "@earendil-works/pi-coding-agent";
import {
  fuzzyFilter,
  type AutocompleteItem,
  type AutocompleteProvider,
} from "@earendil-works/pi-tui";

export const MESSAGE_TYPE = "inline-skill";

export type SkillRef = {
  name: string;
  path: string;
  baseDir: string;
  description?: string;
};

/**
 * An invocation names a skill with `$name` or `/skill:name`. The name runs up to
 * whitespace, CJK text, or sentence punctuation, so a skill is only expanded
 * when the whole word is its name: `$demo-skillX` and `$demo-skill.md` resolve to
 * nothing, while `$demo-skill，继续` and `$demo-skill` resolve to `demo-skill`.
 * The lookbehind keeps escapes (`\$name`), paths (`/tmp/$name`), and identifier
 * tails (`foo$name`) literal.
 */
const NAME_STOP =
  `\\s\\u3000-\\u303f\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef,;:!?()\\[\\]{}'"\``;
const SKILL_TOKEN = new RegExp(`(?<![\\\\\\w$/])(\\$|\\/skill:)([^${NAME_STOP}]+)`, "gu");

/** A marker still being typed: `$` or `/skill:` followed by an optional partial name. */
const COMPLETION_TOKEN = new RegExp(`(?<![\\\\\\w$/])(\\$|\\/skill:)([^${NAME_STOP}]*)$`, "u");

/** Pi expands only a command at the very start of the message. */
const LEADING_SKILL_COMMAND = /^\/skill:(\S+)/u;

const MAX_SUGGESTIONS = 20;

function skillMap(commands: readonly SlashCommandInfo[]): Map<string, SkillRef> {
  const skills = new Map<string, SkillRef>();
  for (const command of commands) {
    if (command.source !== "skill") continue;
    const name = command.name.startsWith("skill:") ? command.name.slice(6) : command.name;
    const path = command.sourceInfo.path;
    skills.set(name, {
      name,
      path,
      // Pi emits the directory that holds SKILL.md, which is what a relative
      // reference inside the skill resolves against. `sourceInfo.baseDir` is
      // the resource root instead, so it cannot be used here.
      baseDir: dirname(path),
      description: command.description,
    });
  }
  return skills;
}

/**
 * Resolve every skill a message refers to.
 *
 * Pi expands a leading `/skill:name` itself, so that occurrence is left to Pi;
 * expanding it here as well would put the same instructions in context twice.
 * Unknown names (`$PATH`, `$9.99`, `$unknown-skill`) resolve to nothing, which
 * keeps prose, prices, and paths intact.
 */
export function collectSkillInvocations(
  text: string,
  commands: readonly SlashCommandInfo[],
): SkillRef[] {
  const skills = skillMap(commands);
  // Pi expands a leading `/skill:name` command itself; the same skill must not
  // enter context twice when the message also mentions it inline.
  const handledByPi = LEADING_SKILL_COMMAND.exec(text)?.[1];
  const found = new Map<string, SkillRef>();

  for (const match of text.matchAll(SKILL_TOKEN)) {
    const [, marker, name] = match as unknown as [string, string, string];
    if (marker === "/skill:" && match.index === 0) continue;
    const skill = skills.get(name);
    if (!skill || skill.name === handledByPi) continue;
    found.set(name, skill);
  }

  return [...found.values()];
}

/** The block Pi renders as a collapsible skill card and parses back with `parseSkillBlock`. */
export function buildSkillBlock(skill: SkillRef): string {
  const body = stripFrontmatter(readFileSync(skill.path, "utf8")).trim();
  return [
    `<skill name="${skill.name}" location="${skill.path}">`,
    `References are relative to ${skill.baseDir}.`,
    "",
    body,
    "</skill>",
  ].join("\n");
}

/**
 * Skill completion stacked on top of the built-in provider. Inside a skill
 * marker the provider answers alone, so file completion never opens there; a
 * marker with no matching skill returns `null` instead of a list.
 */
export function createSkillProvider(
  current: AutocompleteProvider,
  getSkills: () => Map<string, SkillRef>,
): AutocompleteProvider {
  return {
    triggerCharacters: ["$"],

    getSuggestions(lines, cursorLine, cursorCol, options) {
      const beforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
      const match = COMPLETION_TOKEN.exec(beforeCursor);
      if (!match) return current.getSuggestions(lines, cursorLine, cursorCol, options);

      const marker = match[1] as string;
      const query = match[2] as string;
      const skills = [...getSkills().values()];
      const items: AutocompleteItem[] = (query ? fuzzyFilter(skills, query, (skill) => skill.name) : skills)
        .slice(0, MAX_SUGGESTIONS)
        .map((skill) => ({ value: `${marker}${skill.name}`, label: skill.name, description: skill.description }));

      if (items.length === 0) return Promise.resolve(null);
      return Promise.resolve({ prefix: `${marker}${query}`, items });
    },

    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      if (!prefix.startsWith("$") && !prefix.startsWith("/skill:")) {
        return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
      }
      const line = lines[cursorLine] ?? "";
      const beforePrefix = line.slice(0, cursorCol - prefix.length);
      const afterCursor = line.slice(cursorCol);
      const separator = /^\s/.test(afterCursor) ? "" : " ";
      const nextLines = [...lines];
      nextLines[cursorLine] = `${beforePrefix}${item.value}${separator}${afterCursor}`;
      return {
        lines: nextLines,
        cursorLine,
        cursorCol: beforePrefix.length + item.value.length + separator.length,
      };
    },

    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      if (COMPLETION_TOKEN.test((lines[cursorLine] ?? "").slice(0, cursorCol))) return false;
      return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    },
  };
}

export default function inlineSkills(pi: ExtensionAPI): void {
  pi.registerMessageRenderer(MESSAGE_TYPE, (message, options) => {
    const text =
      typeof message.content === "string"
        ? message.content
        : message.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n");
    const skillBlock = parseSkillBlock(text);
    if (!skillBlock) return undefined;

    const component = new SkillInvocationMessageComponent(skillBlock, getMarkdownTheme(), options.outputPad);
    component.setExpanded(options.expanded);
    return component;
  });

  pi.on("session_start", (_event, ctx) => {
    ctx.ui.addAutocompleteProvider((current) =>
      createSkillProvider(current, () => skillMap(pi.getCommands())),
    );
  });

  pi.on("input", (event) => {
    const skills = collectSkillInvocations(event.text, pi.getCommands());
    if (skills.length === 0) return;

    for (const skill of skills) {
      pi.sendMessage(
        {
          customType: MESSAGE_TYPE,
          content: buildSkillBlock(skill),
          display: true,
          details: { name: skill.name },
        },
        event.streamingBehavior ? { deliverAs: event.streamingBehavior } : undefined,
      );
    }

    // The message keeps the markers the user typed; each skill's instructions
    // arrive as its own context message above it.
    return { action: "continue" };
  });
}
