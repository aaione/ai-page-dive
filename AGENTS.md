# AGENTS.md

## Commit & Pull Request Guidelines

Commits follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>[scope]: <description>
```

- **type** (required, lowercase) — `feat` / `fix` / `docs` / `style` / `refactor` / `perf` / `test` / `build` / `ci` / `chore`
- **scope** (optional) — `ext`（apps/extension）/ `host`（packages/host）/ `shared`（packages/shared）/ `repo`
- **description** (required) — imperative mood, lowercase, no trailing period
- **Breaking changes** — append `!` after type/scope (`feat!:`)

示例：`feat(ext): sidePanel 渲染 markdown 流式输出`、`fix(host): pgid 收割遗漏子进程`

### Author

- **Author** — every commit must be authored as `tj <tiejia0319@gmail.com>`. Use `git commit --author="tj <tiejia0319@gmail.com>"` (or set the author identity accordingly) so the recorded author is always `tj <tiejia0319@gmail.com>`, regardless of who runs the commit.
