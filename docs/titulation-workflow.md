# Titulation records and academic students

Each titulation process belongs to an academic student through `studentId`. Graduating preserves the student record, enrollments, course attempts and assistantship history. The institutional account that manages the process is a separate `User`.

The process retains the personal information supplied for that process. Those historical fields are a snapshot for document preparation. The academic student record holds current information. Editing the snapshot fills missing student identifiers but never replaces existing student information automatically.

## Identity matching

The form can select an existing student. Otherwise, the service matches exact normalized RUT or email through the protected Prisma lookup layer. Names never merge people. A mismatch between RUT and email stops the operation with a conflict. New partial students can have a missing RUT or email; no synthetic identifiers are created. Matching and process creation run in a serializable transaction.

## Graduation outcome and process stage

`TitulationOutcome` records the academic situation: unconfirmed, in progress, graduated or not graduated. `TitulationStage` records administrative progress. Closing a process does not assign a graduation outcome.

The supplied legacy database contains graduates, as confirmed by its owner in this task. Its records are classified as `GRADUATED`, while unknown historical stages and document receipt statuses remain unclassified and unverified. Missing dates remain null.

The review view lists unconfirmed outcomes, missing core information or unverified document receipt. It overlaps the graduates view: a graduate can have an incomplete historical record. Counts are global; filters narrow the paginated list.

## Documents

Received files belong to a process and remain in private storage. Word drafts are generated on request using the process snapshot. Generating a draft or uploading a file does not assert receipt, approval or graduation. Support staff records those decisions explicitly.

## Development migration

Prisma migrations add the student relationship and the graduation outcome. The legacy importer validates the development database target before writing, preserves existing values and links historical processes to students. It can be repeated without creating duplicate records. Personal information and credentials must not be included in its output.

Prisma also generated and applied the empty migration `20261118160408_link_titulations_to_students` during development verification. It is retained to preserve the applied migration history; it contains no schema or data operations.
