# prisma complete

Prints a shell completion script.

```bash
prisma complete zsh
prisma complete bash
prisma complete fish
prisma complete powershell
```

For a direct global CLI installation, load the output using the shell's normal startup mechanism. For example, in zsh:

```bash
source <(prisma complete zsh)
```

In this repository, run the installed Prisma CLI with `pnpm exec`. Use `pnpm dlx` for a one-off Prisma tool that is not installed in the project.

## Reference

- [Prisma ORM 7.9.0 release](https://github.com/prisma/prisma/releases/tag/7.9.0)
