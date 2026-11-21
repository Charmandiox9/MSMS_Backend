# Dependency audit baseline

Recorded on 2026-11-18 from the repository lockfiles using the package managers configured at that time. These commands report known advisory matches; runtime exposure and compatible remediation require review.

| Repository | Scope | Critical | High | Moderate | Low |
| --- | --- | ---: | ---: | ---: | ---: |
| Backend | All dependencies | 2 | 10 | 9 | 3 |
| Backend | Production dependencies | 0 | 10 | 6 | 3 |
| Frontend | All dependencies | 0 | 13 | 7 | 0 |
| Frontend | Production dependencies | 0 | 2 | 0 | 0 |

## Remaining findings

The backend production dependency tree reports high severity matches involving `deepmerge-ts`, `mysql2`, `multer`, `@graphql-tools/utils`, `body-parser`, `picomatch`. The complete backend tree also reports critical matches involving `handlebars` in development tooling.

The frontend production audit reports a transitive picomatch advisory through @parcel/watcher. The complete tree includes additional matches in build, lint and test tooling. See the [picomatch advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf).

Audit tools can report different counts because of their formats and should be interpreted per repository. Some advisories have no patched range in the registry response. Automatic major version changes need compatibility assessment.

## Reproduction

Backend and frontend: run `pnpm audit --json` and `pnpm audit --prod --json`.

Raw reports remain in ignored local cache directories. They must not contain application environment values or student data.
