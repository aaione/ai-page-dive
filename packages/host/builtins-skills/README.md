# 技能目录

每个子目录一个技能，内含 SKILL.md：

```
~/.ai-page-dive/skills/my-skill/SKILL.md
```

SKILL.md 格式（frontmatter 的 description 显示在设置列表；正文即注入给 CLI 的增强指令）：

```markdown
---
name: my-skill
description: 一句话说明这个技能做什么
---

# 技能标题

（正文：告诉 CLI 按什么风格/框架输出……）
```

内置技能（eli5、counterpoint 等）随 npm 包分发、只读；在本目录建**同名**子目录即可覆盖定制（升级不动这里，shadow 语义）。
