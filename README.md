# @butcool/pi-inline-skills

Invoke Pi skills anywhere in a prompt with `$name` or `/skill:name`.

```text
请使用 $find-docs 查询 TypeScript 文档
先 $simplify 审查这段代码，再用 /skill:find-docs 核对接口
请使用$find-docs，查询接口文档
```

## 工作方式

- 扫描整条消息里的 `$name` 与 `/skill:name`，名字必须与已加载技能完全一致才展开。
- 每个技能以自己的上下文消息到达模型，格式与 Pi 为 `/skill:name` 生成的完全一致：`<skill name location>References are relative to <技能目录> ... </skill>`。
- 用户消息保持输入时的样子，只把技能说明插在它之前，不重写原文。
- 在 TUI 中每个技能显示为一张可折叠的技能卡片，与 Pi 内建的表现相同。

## 安装

```bash
pi install npm:@butcool/pi-inline-skills
```

## 使用

- 在输入框任意位置输入 `$` 或 `/skill:`，候选列表会列出当前会话已发现的技能：个人技能、项目技能、包中技能都在内。
- 继续输入做模糊筛选：`$docs` 命中 `find-docs`，`$open` 命中 `iwhale-open-api`。
- `Tab` 或 `Enter` 插入技能名，之后继续编辑或发送。
- 候选列表里不会出现文件路径补全；在技能标记内按 `Tab` 也不会落到路径补全。
- 一条消息可以引用多个技能，每个技能各自一张卡片。
- 同一技能在一句里写多次只加载一次。

## 边界规则

| 输入 | 结果 |
|---|---|
| `$find-docs`、`请使用$find-docs，继续` | 展开 |
| `$PATH`、`$9.99`、`$unknown-skill` | 原样保留 |
| `$find-docsX`、`$find-docs_extra`、`$find-docs.md` | 原样保留，整个词必须是技能名 |
| `\$find-docs` | 原样保留，反斜杠转义 |
| `/tmp/$find-docs`、`foo$find-docs` | 原样保留，路径与标识符尾巴不展开 |
| 消息开头的 `/skill:find-docs` | 交给 Pi 自己展开，不重复加载 |
| 消息中间或行内的 `/skill:find-docs` | 展开 |

补全列表需要标记前是行首或空白（Pi 编辑器的触发规则）；紧邻中文写的 `$find-docs` 不会弹候选，但发送时照常展开。

## 与其他实现的分工

本包只做两件事：把技能标记解析成 Pi 原生的技能块，以及在标记内提供技能候选。它不改写编辑器、不替换补全组件、不劫持按键，因此可以和自定义编辑器、状态栏扩展共存。

## 开发

```bash
npm install
npm run typecheck
npm test                       # 真实技能文件、真实补全组件、真实会话
uv run --with pexpect --with pyte tests/terminal.py   # 真实 TUI
npm pack --dry-run
```

## 发布

推送到 `main` 即通过 npm trusted publishing（OIDC）发布，仓库不保存 token。版本未变时工作流跳过：

```bash
npm version patch --no-git-tag-version
# 更新 CHANGELOG.md
git commit -am "release: v1.0.1"
git push
```

## License

MIT
