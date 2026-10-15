import { Injectable } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { academicScheduleBlocks } from './schedule-blocks';
import { calculateHourlyPayment } from './hourly-payment-calculator';

export type AcademicDataset =
  | 'teachers'
  | 'courses'
  | 'assignments'
  | 'assistants'
  | 'assistantships'
  | 'semesters'
  | 'projects'
  | 'research'
  | 'researchOutputs'
  | 'hourlyContracts';
export type ReportRow = Record<string, string | number | null>;
const time = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const reportTextFilter = (value: string) => ({
  contains: value.replace(/[\\%_]/g, '\\$&'),
  mode: 'insensitive' as const,
});

@Injectable()
export class AcademicReportsService {
  constructor(private readonly prisma: PrismaService) {}

  semesterOptions() {
    return this.prisma.academicSemester.findMany({
      select: { id: true, name: true },
      orderBy: [{ startsOn: 'desc' }, { id: 'asc' }],
    });
  }

  async data(
    dataset: AcademicDataset,
    semesterId?: string,
    search?: string,
    reportingYear?: number,
    startsOn?: string,
    endsOn?: string,
    page?: number,
    pageSize = 20,
  ) {
    if (startsOn && endsOn && startsOn > endsOn)
      throw new BadRequestException(
        'La fecha inicial debe ser anterior a la fecha final',
      );
    let rows: ReportRow[];
    let columns: string[];
    const usesDatabasePagination =
      page !== undefined &&
      ['projects', 'research', 'researchOutputs'].includes(dataset);
    const assignmentFilter = semesterId ? { semesterId } : {};
    switch (dataset) {
      case 'teachers':
        columns = ['name', 'email', 'status', 'courses'];
        rows = (
          await this.prisma.teacher.findMany({
            where: semesterId
              ? { assignments: { some: assignmentFilter } }
              : {},
            include: {
              assignments: {
                where: assignmentFilter,
                include: { course: true, semester: true },
              },
            },
            orderBy: { id: 'asc' },
          })
        ).map((item) => ({
          name: item.name,
          email: item.email,
          status: item.isActive ? 'ACTIVE' : 'INACTIVE',
          courses: item.assignments
            .map((a) => `${a.course.name} (${a.nrc}, ${a.semester.name})`)
            .join('; '),
        }));
        break;
      case 'courses':
        columns = ['code', 'name', 'courses', 'schedules'];
        rows = (
          await this.prisma.course.findMany({
            where: semesterId
              ? {
                  OR: [
                    { assignments: { some: assignmentFilter } },
                    { schedules: { some: assignmentFilter } },
                  ],
                }
              : {},
            include: {
              assignments: {
                where: assignmentFilter,
                include: { semester: true },
              },
              schedules: {
                where: assignmentFilter,
                include: { semester: true },
              },
            },
            orderBy: { id: 'asc' },
          })
        ).map((item) => ({
          code: item.code,
          name: item.name,
          courses: item.assignments
            .map((a) => `${a.nrc} (${a.semester.name})`)
            .join('; '),
          schedules: item.schedules
            .map(
              (slot) =>
                `${slot.nrc}: ${slot.day} ${slot.block}${slot.location ? ` · ${slot.location}` : ''} (${slot.semester.name})`,
            )
            .join('; '),
        }));
        break;
      case 'assignments':
        columns = ['semester', 'course', 'courseNrc', 'teacher', 'email'];
        rows = (
          await this.prisma.teachingAssignment.findMany({
            where: assignmentFilter,
            include: { course: true, teacher: true, semester: true },
            orderBy: { semester: { startsOn: 'desc' } },
          })
        ).map((a) => ({
          semester: a.semester.name,
          course: a.course.name,
          courseNrc: a.nrc,
          teacher: a.teacher.name,
          email: a.teacher.email,
        }));
        break;
      case 'assistants':
        columns = ['name', 'email', 'status', 'courses'];
        rows = (
          await this.prisma.teachingAssistant.findMany({
            where: semesterId
              ? {
                  approvals: {
                    some: {
                      assistantships: {
                        some: { teachingAssignment: assignmentFilter },
                      },
                    },
                  },
                }
              : {},
            include: { approvals: { include: { course: true } } },
            orderBy: { id: 'asc' },
          })
        ).map((item) => ({
          name: item.name,
          email: item.email,
          status: item.isActive ? 'ACTIVE' : 'INACTIVE',
          courses: item.approvals.map((a) => a.course.name).join('; '),
        }));
        break;
      case 'assistantships':
        columns = [
          'semester',
          'assistantshipNrc',
          'course',
          'courseNrc',
          'teacher',
          'name',
          'email',
          'startsOn',
          'endsOn',
          'weeklyHours',
          'schedules',
        ];
        rows = (
          await this.prisma.assistantship.findMany({
            where: { teachingAssignment: assignmentFilter },
            include: {
              teachingAssignment: {
                include: { semester: true, course: true, teacher: true },
              },
              approval: { include: { assistant: true } },
              schedules: true,
            },
            orderBy: { startsOn: 'desc' },
          })
        ).map((item) => ({
          semester: item.teachingAssignment.semester.name,
          assistantshipNrc: item.nrc,
          course: item.teachingAssignment.course.name,
          courseNrc: item.teachingAssignment.nrc,
          teacher: item.teachingAssignment.teacher.name,
          name: item.approval.assistant.name,
          email: item.approval.assistant.email,
          startsOn: item.startsOn.toISOString().slice(0, 10),
          endsOn: item.endsOn?.toISOString().slice(0, 10) ?? null,
          weeklyHours: item.weeklyHours?.toNumber() ?? null,
          schedules: item.schedules
            .map(
              (schedule) =>
                `${schedule.weekday} ${academicScheduleBlocks.find((block) => block.startsAtMinute === schedule.startsAtMinute && block.endsAtMinute === schedule.endsAtMinute)?.code ?? ''} ${time(schedule.startsAtMinute)}–${time(schedule.endsAtMinute)}${schedule.location ? ` (${schedule.location})` : ''}`,
            )
            .join('; '),
        }));
        break;
      case 'semesters':
        columns = ['name', 'startsOn', 'endsOn', 'status'];
        rows = (
          await this.prisma.academicSemester.findMany({
            where: semesterId ? { id: semesterId } : {},
            orderBy: { startsOn: 'desc' },
          })
        ).map((item) => ({
          name: item.name,
          startsOn: item.startsOn.toISOString().slice(0, 10),
          endsOn: item.endsOn.toISOString().slice(0, 10),
          status: item.isActive ? 'ACTIVE' : 'INACTIVE',
        }));
        break;
      case 'projects':
        columns = [
          'reportingYear',
          'title',
          'code',
          'academicUnit',
          'status',
          'classification',
          'fundingSource',
          'program',
          'currency',
          'totalAmount',
          'vraContribution',
          'vridtContribution',
          'recoveryAmount',
          'facultyContribution',
          'depreciationAmount',
          'profitabilityAmount',
          'startsOn',
          'endsOn',
          'closedOn',
        ];
        const projectWhere = this.projectWhere({
          search,
          reportingYear,
          startsOn,
          endsOn,
        });
        rows = (
          await this.prisma.project.findMany({
            where: projectWhere,
            select: {
              reportingYear: true,
              title: true,
              code: true,
              academicUnit: true,
              status: true,
              classification: true,
              fundingSource: true,
              program: true,
              currency: true,
              totalAmount: true,
              vraContribution: true,
              vridtContribution: true,
              recoveryAmount: true,
              facultyContribution: true,
              depreciationAmount: true,
              profitabilityAmount: true,
              startsOn: true,
              endsOn: true,
              closedOn: true,
            },
            orderBy: [{ reportingYear: 'desc' }, { title: 'asc' }, { id: 'asc' }],
            ...(usesDatabasePagination
              ? { skip: ((page ?? 1) - 1) * pageSize }
              : {}),
            ...(usesDatabasePagination ? { take: pageSize } : {}),
          })
        ).map((project) => ({
          reportingYear: project.reportingYear,
          title: project.title,
          code: project.code,
          academicUnit: project.academicUnit,
          status: project.status,
          classification: project.classification,
          fundingSource: project.fundingSource,
          program: project.program,
          currency: project.currency,
          totalAmount: project.totalAmount?.toString() ?? null,
          vraContribution: project.vraContribution?.toString() ?? null,
          vridtContribution: project.vridtContribution?.toString() ?? null,
          recoveryAmount: project.recoveryAmount?.toString() ?? null,
          facultyContribution: project.facultyContribution?.toString() ?? null,
          depreciationAmount: project.depreciationAmount?.toString() ?? null,
          profitabilityAmount: project.profitabilityAmount?.toString() ?? null,
          startsOn: project.startsOn?.toISOString().slice(0, 10) ?? null,
          endsOn: project.endsOn?.toISOString().slice(0, 10) ?? null,
          closedOn: project.closedOn?.toISOString().slice(0, 10) ?? null,
        }));
        break;
      case 'research':
        columns = [
          'title',
          'code',
          'academicUnit',
          'researchArea',
          'project',
          'startsOn',
          'endsOn',
          'outputCount',
        ];
        const researchWhere = this.researchWhere({
          search,
          reportingYear,
          startsOn,
          endsOn,
        });
        rows = (
          await this.prisma.research.findMany({
            where: researchWhere,
            select: {
              title: true,
              code: true,
              academicUnit: true,
              researchArea: true,
              startsOn: true,
              endsOn: true,
              project: { select: { title: true } },
              _count: { select: { outputs: true } },
            },
            orderBy: [{ startsOn: 'desc' }, { title: 'asc' }, { id: 'asc' }],
            ...(usesDatabasePagination
              ? { skip: ((page ?? 1) - 1) * pageSize }
              : {}),
            ...(usesDatabasePagination ? { take: pageSize } : {}),
          })
        ).map((research) => ({
          title: research.title,
          code: research.code,
          academicUnit: research.academicUnit,
          researchArea: research.researchArea,
          project: research.project?.title ?? null,
          startsOn: research.startsOn?.toISOString().slice(0, 10) ?? null,
          endsOn: research.endsOn?.toISOString().slice(0, 10) ?? null,
          outputCount: research._count.outputs,
        }));
        break;
      case 'researchOutputs':
        columns = [
          'reportingYear',
          'kind',
          'title',
          'research',
          'journal',
          'publisher',
          'quartile',
          'indexation',
          'publicationDate',
          'authorCount',
          'projectCount',
        ];
        const outputWhere = this.outputWhere({
          search,
          reportingYear,
          startsOn,
          endsOn,
        });
        rows = (
          await this.prisma.researchOutput.findMany({
            where: outputWhere,
            select: {
              reportingYear: true,
              kind: true,
              title: true,
              journal: true,
              publisher: true,
              quartile: true,
              indexation: true,
              publicationDate: true,
              research: { select: { title: true } },
              _count: { select: { authors: true, projects: true } },
            },
            orderBy: [{ reportingYear: 'desc' }, { title: 'asc' }, { id: 'asc' }],
            ...(usesDatabasePagination
              ? { skip: ((page ?? 1) - 1) * pageSize }
              : {}),
            ...(usesDatabasePagination ? { take: pageSize } : {}),
          })
        ).map((output) => ({
          reportingYear: output.reportingYear,
          kind: output.kind,
          title: output.title,
          research: output.research?.title ?? null,
          journal: output.journal,
          publisher: output.publisher,
          quartile: output.quartile,
          indexation: output.indexation,
          publicationDate:
            output.publicationDate?.toISOString().slice(0, 10) ?? null,
          authorCount: output._count.authors,
          projectCount: output._count.projects,
        }));
        break;
      case 'hourlyContracts':
        columns = [
          'semester',
          'teacher',
          'course',
          'nrc',
          'component',
          'parallel',
          'directHours',
          'startsOn',
          'endsOn',
          'hourlyRateClp',
          'monthlyAmountClp',
          'estimatedPaymentClp',
        ];
        rows = (
          await this.prisma.hourlyTeachingContract.findMany({
            where: {
              ...(semesterId ? { semesterId } : {}),
              ...(reportingYear
                ? {
                    startsOn: {
                      gte: new Date(`${reportingYear}-01-01T00:00:00.000Z`),
                      lt: new Date(`${reportingYear + 1}-01-01T00:00:00.000Z`),
                    },
                  }
                : {}),
            },
            include: {
              teachingAssignment: {
                include: { semester: true, course: true, teacher: true },
              },
            },
            orderBy: [
              { teachingAssignment: { semester: { startsOn: 'desc' } } },
              { startsOn: 'desc' },
            ],
          })
        ).map((contract) => {
          const calculation = calculateHourlyPayment({
            hourlyRateClp: contract.hourlyRateClp,
            directHours: contract.directHours,
            startsOn: contract.startsOn,
            endsOn: contract.endsOn,
          });
          return {
            semester: contract.teachingAssignment.semester.name,
            teacher: contract.teachingAssignment.teacher.name,
            course: contract.teachingAssignment.course.name,
            nrc: contract.teachingAssignment.nrc,
            component: contract.component,
            parallel: contract.parallel,
            directHours: contract.directHours.toString(),
            startsOn: contract.startsOn.toISOString().slice(0, 10),
            endsOn: contract.endsOn.toISOString().slice(0, 10),
            hourlyRateClp: contract.hourlyRateClp.toString(),
            monthlyAmountClp: calculation.monthlyAmountClp,
            estimatedPaymentClp: calculation.totalAmountClp,
          };
        });
        break;
    }
    const needle = ['projects', 'research', 'researchOutputs'].includes(dataset)
      ? undefined
      : search?.trim().toLocaleLowerCase();
    if (['teachers', 'assistants', 'courses'].includes(dataset))
      rows.sort((a, b) =>
        String(a.name ?? '').localeCompare(String(b.name ?? ''), 'es'),
      );
    if (!usesDatabasePagination)
      return {
        columns,
        rows: needle
          ? rows.filter((row) =>
              Object.values(row).some((value) =>
                String(value ?? '')
                  .toLocaleLowerCase()
                  .includes(needle),
              ),
            )
          : rows,
      };
    const filters = {
      search,
      reportingYear,
      startsOn,
      endsOn,
    };
    const totalRows =
      dataset === 'projects'
        ? await this.prisma.project.count({
            where: this.projectWhere(filters),
          })
        : dataset === 'research'
          ? await this.prisma.research.count({
              where: this.researchWhere(filters),
            })
          : await this.prisma.researchOutput.count({
              where: this.outputWhere(filters),
            });
    return { columns, rows, totalRows, page, pageSize };
  }

  private projectWhere(filters: {
    search?: string;
    reportingYear?: number;
    startsOn?: string;
    endsOn?: string;
  }): Prisma.ProjectWhereInput {
    const search = filters.search?.trim();
    return {
      ...(search
        ? {
            OR: [
              { title: reportTextFilter(search) },
              { code: reportTextFilter(search) },
              { academicUnit: reportTextFilter(search) },
              { classification: reportTextFilter(search) },
              { fundingSource: reportTextFilter(search) },
              { program: reportTextFilter(search) },
              { currency: reportTextFilter(search) },
            ],
          }
        : {}),
      ...(filters.reportingYear
        ? { reportingYear: filters.reportingYear }
        : {}),
      ...(filters.startsOn || filters.endsOn
        ? {
            ...(filters.endsOn
              ? {
                  startsOn: {
                    lte: new Date(`${filters.endsOn}T23:59:59.999Z`),
                  },
                }
              : {}),
            ...(filters.startsOn
              ? {
                  endsOn: {
                    gte: new Date(`${filters.startsOn}T00:00:00.000Z`),
                  },
                }
              : {}),
          }
        : {}),
    };
  }

  private researchWhere(filters: {
    search?: string;
    reportingYear?: number;
    startsOn?: string;
    endsOn?: string;
  }): Prisma.ResearchWhereInput {
    const search = filters.search?.trim();
    return {
      AND: [
        ...(search
          ? [
              {
                OR: [
                  { title: reportTextFilter(search) },
                  { code: reportTextFilter(search) },
                  { academicUnit: reportTextFilter(search) },
                  { researchArea: reportTextFilter(search) },
                  { project: { is: { title: reportTextFilter(search) } } },
                ],
              },
            ]
          : []),
        ...(filters.reportingYear
          ? [
              {
                startsOn: {
                  gte: new Date(`${filters.reportingYear}-01-01T00:00:00.000Z`),
                  lt: new Date(
                    `${filters.reportingYear + 1}-01-01T00:00:00.000Z`,
                  ),
                },
              },
            ]
          : []),
        ...(filters.endsOn
          ? [
              {
                startsOn: {
                  lte: new Date(`${filters.endsOn}T23:59:59.999Z`),
                },
              },
            ]
          : []),
        ...(filters.startsOn
          ? [
              {
                OR: [
                  {
                    endsOn: {
                      gte: new Date(`${filters.startsOn}T00:00:00.000Z`),
                    },
                  },
                  { endsOn: null },
                ],
              },
            ]
          : []),
      ],
    };
  }

  private outputWhere(filters: {
    search?: string;
    reportingYear?: number;
    startsOn?: string;
    endsOn?: string;
  }): Prisma.ResearchOutputWhereInput {
    const search = filters.search?.trim();
    return {
      ...(search
        ? {
            OR: [
              { title: reportTextFilter(search) },
              { doi: reportTextFilter(search) },
              { journal: reportTextFilter(search) },
              { publisher: reportTextFilter(search) },
              { indexation: reportTextFilter(search) },
              { research: { is: { title: reportTextFilter(search) } } },
            ],
          }
        : {}),
      ...(filters.reportingYear
        ? { reportingYear: filters.reportingYear }
        : {}),
      ...(filters.startsOn || filters.endsOn
        ? {
            publicationDate: {
              ...(filters.startsOn
                ? { gte: new Date(`${filters.startsOn}T00:00:00.000Z`) }
                : {}),
              ...(filters.endsOn
                ? { lte: new Date(`${filters.endsOn}T23:59:59.999Z`) }
                : {}),
            },
          }
        : {}),
    };
  }
}
