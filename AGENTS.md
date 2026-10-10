# Project development rules

- Use this repository's single primary working directory for normal development. Do not create or use additional Git worktrees for this project.
- Keep `main` as the only long-term development baseline. Ordinary branches in this same working directory are allowed for isolated changes; preserve or commit working changes before switching branches.
- Before handoff, state clearly which changes are uncommitted, committed but unpushed, pushed but not deployed, deployed, and not yet integrated.
- Keep the seasonal theme as a removable visual module. Put functionality, calculation/data changes, shared UI/UX, accessibility, and responsive layout in the main codebase; seasonal files may contain visual styling and decorative effects only.
- Do not remove user data, unintegrated work, or files with uncertain purpose. Verify generated artifacts and references before cleaning them; do not use broad Git cleanup commands.
- For structural codebase exploration, use the installed `codebase-memory` skill.
