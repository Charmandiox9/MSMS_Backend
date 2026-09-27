import { randomUUID } from 'crypto';

type Where = Record<string, unknown>;
type RoleCode = string;

export interface SeedUser {
  id: string;
  email: string;
  name?: string;
  isActive?: boolean;
  roles: RoleCode[];
}

export interface SeedAssignment {
  nrc: string;
  activeSemester: boolean;
  course: { name: string; code: string };
  teacher: { id: string; name: string; email: string };
}

export interface SeedSchedule {
  nrc: string;
  day: string;
  block: string;
  activeSemester: boolean;
}

type Row = Record<string, unknown> & { id: string };

function pick<T extends Row>(row: T): T {
  return { ...row };
}

function matchesSemester(activeSemester: boolean, where: Where): boolean {
  const semester = where.semester as { isActive?: boolean } | undefined;
  return (
    semester?.isActive === undefined || semester.isActive === activeSemester
  );
}

/**
 * Prisma en memoria para E2E. Implementa las consultas del flujo de
 * justificaciones y autenticación; cualquier otro modelo responde con valores
 * vacíos para que los endpoints restantes puedan ejercitarse sin base de datos.
 */
export function createInMemoryPrisma() {
  const users = new Map<string, SeedUser>();
  const assignments: SeedAssignment[] = [];
  const schedules: SeedSchedule[] = [];
  const inbox = new Map<string, Row>();
  const justifications = new Map<string, Row>();
  const history: Row[] = [];

  const client: Record<string, unknown> = {
    seedUser(user: SeedUser) {
      users.set(user.id, { isActive: true, name: user.email, ...user });
    },
    seedAssignment(assignment: SeedAssignment) {
      assignments.push(assignment);
    },
    seedSchedule(schedule: SeedSchedule) {
      schedules.push(schedule);
    },
    reset() {
      users.clear();
      assignments.length = 0;
      schedules.length = 0;
      inbox.clear();
      justifications.clear();
      history.length = 0;
    },
    tables: { inbox, justifications, history },

    $connect: () => Promise.resolve(),
    $disconnect: () => Promise.resolve(),
    $transaction: (operation: (tx: unknown) => Promise<unknown>) =>
      operation(proxy),

    user: {
      findUnique: ({ where }: { where: { id: string } }) => {
        const user = users.get(where.id);
        if (!user) return Promise.resolve(null);
        return Promise.resolve({
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: null,
          isActive: user.isActive,
          userRoles: user.roles.map((code) => ({ role: { code } })),
        });
      },
    },

    teachingAssignment: {
      findFirst: ({ where }: { where: Where }) => {
        const found = assignments.find(
          (a) =>
            a.nrc === where.nrc && matchesSemester(a.activeSemester, where),
        );
        return Promise.resolve(
          found
            ? {
                nrc: found.nrc,
                courseId: found.course.code,
                course: found.course,
              }
            : null,
        );
      },
      findMany: ({ where }: { where: Where }) => {
        const seen = new Set<string>();
        const teachers = assignments
          .filter(
            (a) =>
              a.nrc === where.nrc && matchesSemester(a.activeSemester, where),
          )
          .filter((a) => !seen.has(a.teacher.id) && seen.add(a.teacher.id))
          .map((a) => ({
            teacher: { name: a.teacher.name, email: a.teacher.email },
          }));
        return Promise.resolve(teachers);
      },
    },

    courseSchedule: {
      findMany: ({ where }: { where: Where }) =>
        Promise.resolve(
          schedules
            .filter(
              (s) =>
                s.nrc === where.nrc &&
                s.day === where.day &&
                matchesSemester(s.activeSemester, where),
            )
            .map((s) => s.block)
            .sort()
            .map((block) => ({ block })),
        ),
    },

    justificationInbox: {
      upsert: ({
        where,
        create,
        update,
      }: {
        where: { externalResponseId: string };
        create: Row;
        update: Row;
      }) => {
        const existing = [...inbox.values()].find(
          (row) => row.externalResponseId === where.externalResponseId,
        );
        const now = new Date();
        const row: Row = existing
          ? { ...existing, ...update, updatedAt: now }
          : {
              status: 'UNREAD',
              readAt: null,
              justificationId: null,
              createdAt: now,
              updatedAt: now,
              ...create,
              id: randomUUID(),
            };
        inbox.set(row.id, row);
        return Promise.resolve(pick(row));
      },
      findMany: ({ where }: { where: { status: string } }) =>
        Promise.resolve(
          [...inbox.values()]
            .filter((row) => row.status === where.status)
            .map(pick),
        ),
      findUnique: ({ where }: { where: { id: string } }) => {
        const row = inbox.get(where.id);
        return Promise.resolve(row ? pick(row) : null);
      },
      update: ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = { ...inbox.get(where.id)!, ...data };
        inbox.set(where.id, row);
        return Promise.resolve(pick(row));
      },
    },

    justification: {
      findMany: ({ where }: { where?: { status?: string } }) =>
        Promise.resolve(
          [...justifications.values()]
            .filter((row) => !where?.status || row.status === where.status)
            .map(pick),
        ),
      findUnique: ({ where }: { where: { id: string } }) => {
        const row = justifications.get(where.id);
        return Promise.resolve(row ? pick(row) : null);
      },
      findUniqueOrThrow: ({ where }: { where: { id: string } }) => {
        const row = justifications.get(where.id);
        return row
          ? Promise.resolve(pick(row))
          : Promise.reject(new Error('No record found'));
      },
      create: ({ data }: { data: Row & { history?: { create: Row } } }) => {
        const { history: nestedHistory, ...fields } = data;
        const now = new Date();
        const row: Row = {
          status: 'PENDING',
          rejectionReason: null,
          decidedAt: null,
          decidedById: null,
          openedAt: now,
          createdAt: now,
          updatedAt: now,
          ...fields,
        };
        justifications.set(row.id, row);
        if (nestedHistory)
          history.push({
            id: randomUUID(),
            justificationId: row.id,
            ...nestedHistory.create,
          });
        return Promise.resolve(pick(row));
      },
      update: ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = {
          ...justifications.get(where.id)!,
          ...data,
          updatedAt: new Date(),
        };
        justifications.set(where.id, row);
        return Promise.resolve(pick(row));
      },
    },

    justificationStatusHistory: {
      create: ({ data }: { data: Row }) => {
        const row = { ...data, id: randomUUID() };
        history.push(row);
        return Promise.resolve(pick(row));
      },
    },
  };

  const emptyModel = new Proxy(
    {},
    {
      get: (_target, method: string) => () => {
        if (method === 'findMany') return Promise.resolve([]);
        if (method === 'count') return Promise.resolve(0);
        if (method.startsWith('find')) return Promise.resolve(null);
        return Promise.resolve({});
      },
    },
  );

  const proxy: typeof client = new Proxy(client, {
    get: (target, property: string) =>
      property in target ? target[property] : emptyModel,
  });

  return proxy as InMemoryPrisma;
}

export type InMemoryPrisma = {
  seedUser(user: SeedUser): void;
  seedAssignment(assignment: SeedAssignment): void;
  seedSchedule(schedule: SeedSchedule): void;
  reset(): void;
  tables: {
    inbox: Map<string, Row>;
    justifications: Map<string, Row>;
    history: Row[];
  };
};
