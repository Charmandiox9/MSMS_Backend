import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface TeacherImportRow {
  teacherEmail: string;
  teacherName: string;
  courseCode: string;
  courseName: string;
  nrc: string;
  semesterName: string;
  startsOn: string;
  endsOn: string;
  employeeCode?: string;
}

interface CourseScheduleImportRow {
  nrc: string;
  subjectName: string;
  day: string;
  block: string;
}

const DAYS = new Map([
  ['lunes', 'Lunes'],
  ['martes', 'Martes'],
  ['miercoles', 'Miércoles'],
  ['jueves', 'Jueves'],
  ['viernes', 'Viernes'],
  ['sabado', 'Sábado'],
]);
const BLOCKS = new Set(['A', 'B', 'C', 'C2', 'D', 'E', 'F', 'G', 'H']);

@Injectable()
export class AcademicService {
  constructor(private readonly prisma: PrismaService) {}

  listSemesters() {
    return this.prisma.academicSemester.findMany({ orderBy: [{ isActive: 'desc' }, { startsOn: 'desc' }] });
  }

  async activateSemester(name: string, startsOnValue: string, endsOnValue: string) {
    const startsOn = this.parseDate(startsOnValue);
    const endsOn = this.parseDate(endsOnValue);
    if (endsOn <= startsOn) throw new BadRequestException('La fecha de término debe ser posterior al inicio');

    return this.prisma.$transaction(async (transaction) => {
      const semester = await transaction.academicSemester.upsert({
        where: { name: name.trim() },
        update: { startsOn, endsOn, isActive: true },
        create: { name: name.trim(), startsOn, endsOn, isActive: true },
      });
      await transaction.academicSemester.updateMany({ where: { id: { not: semester.id } }, data: { isActive: false } });
      return semester;
    });
  }

  listTeachers() {
    return this.prisma.teacher.findMany({
      orderBy: { name: 'asc' },
      include: {
        assignments: {
          where: { semester: { isActive: true } },
          include: { course: true, semester: true },
          orderBy: { course: { name: 'asc' } },
        },
      },
    });
  }

  getTeacher(id: string) {
    return this.prisma.teacher.findUnique({
      where: { id },
      include: {
        assignments: {
          where: { semester: { isActive: true } },
          include: { course: true, semester: true },
        },
      },
    });
  }

  async importCsv(csv: string) {
    const rows = this.parseCsv(csv);
    if (rows.length === 0) throw new BadRequestException('El CSV no contiene filas');

    return this.prisma.$transaction(async (transaction) => {
      const first = rows[0];
      const startsOn = this.parseDate(first.startsOn);
      const endsOn = this.parseDate(first.endsOn);
      const semester = await transaction.academicSemester.upsert({
        where: { name: first.semesterName },
        update: { startsOn, endsOn, isActive: true },
        create: { name: first.semesterName, startsOn, endsOn, isActive: true },
      });
      await transaction.academicSemester.updateMany({ where: { id: { not: semester.id } }, data: { isActive: false } });

      for (const row of rows) {
        const teacher = await transaction.teacher.upsert({
          where: { email: row.teacherEmail },
          update: { name: row.teacherName, employeeCode: row.employeeCode },
          create: { email: row.teacherEmail, name: row.teacherName, employeeCode: row.employeeCode },
        });
        const course = await transaction.course.upsert({
          where: { code_name: { code: row.courseCode, name: row.courseName } },
          update: {},
          create: { code: row.courseCode, name: row.courseName },
        });
        await transaction.teachingAssignment.upsert({
          where: { semesterId_teacherId_courseId_nrc: { semesterId: semester.id, teacherId: teacher.id, courseId: course.id, nrc: row.nrc } },
          update: { parallel: '' },
          create: { semesterId: semester.id, teacherId: teacher.id, courseId: course.id, nrc: row.nrc, parallel: '' },
        });
      }

      return { semesterId: semester.id, importedRows: rows.length };
    });
  }

  async importTeacherRoster(csv: string) {
    const lines = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) throw new BadRequestException('El CSV de profesores no contiene filas');

    const headers = this.splitCsvLine(lines[0]).map((header) => this.normalizeHeader(header));
    const nameIndex = headers.findIndex((header) => ['nombre', 'name', 'teachername'].includes(header));
    const emailIndex = headers.findIndex((header) => ['correo', 'email', 'teacheremail'].includes(header));
    if (nameIndex < 0 || emailIndex < 0 || headers.length < 3) {
      throw new BadRequestException('El CSV debe incluir nombre, correo y al menos una columna de NRC');
    }

    const rows = lines.slice(1).map((line) => {
      const values = this.splitCsvLine(line).map((value) => value.trim());
      const nrcs = values
        .filter((value, index) => index !== nameIndex && index !== emailIndex && value)
        .flatMap((value) => value.split(/[|,]/).map((nrc) => nrc.trim()).filter(Boolean));
      if (!values[nameIndex] || !values[emailIndex] || nrcs.length === 0) throw new BadRequestException('Hay una fila incompleta en el CSV de profesores');
      return { name: values[nameIndex], email: values[emailIndex], nrcs: [...new Set(nrcs)] };
    });

    return this.prisma.$transaction(async (transaction) => {
      const semester = await transaction.academicSemester.findFirst({ where: { isActive: true } });
      if (!semester) throw new BadRequestException('No existe un semestre activo. Importa primero la carga académica o crea el semestre.');

      let importedAssignments = 0;
      for (const row of rows) {
        const teacher = await transaction.teacher.upsert({
          where: { email: row.email },
          update: { name: row.name },
          create: { name: row.name, email: row.email },
        });
        for (const nrc of row.nrcs) {
          const assignment = await transaction.teachingAssignment.findFirst({
            where: { semesterId: semester.id, nrc },
            select: { courseId: true },
          });
          const schedule = assignment
            ? null
            : await transaction.courseSchedule.findFirst({
                where: { semesterId: semester.id, nrc },
                select: { courseId: true },
              });
          const courseId = assignment?.courseId ?? schedule?.courseId;
          if (!courseId) throw new BadRequestException(`El NRC ${nrc} no está cargado en el semestre activo`);
          await transaction.teachingAssignment.upsert({
            where: { semesterId_teacherId_courseId_nrc: { semesterId: semester.id, teacherId: teacher.id, courseId, nrc } },
            update: {},
            create: { semesterId: semester.id, teacherId: teacher.id, courseId, nrc, parallel: '' },
          });
          importedAssignments += 1;
        }
      }
      return { semesterId: semester.id, importedTeachers: rows.length, importedAssignments };
    });
  }

  listCourseSchedules() {
    return this.prisma.courseSchedule.findMany({
      where: { semester: { isActive: true } },
      orderBy: [{ day: 'asc' }, { block: 'asc' }, { course: { name: 'asc' } }],
      include: { course: true, semester: true },
    });
  }

  async importCourseSchedules(csv: string) {
    const rows = this.parseCourseScheduleCsv(csv);
    if (rows.length === 0) throw new BadRequestException('El CSV no contiene filas');

    return this.prisma.$transaction(async (transaction) => {
      const semester = await transaction.academicSemester.findFirst({ where: { isActive: true } });
      if (!semester) throw new BadRequestException('No existe un semestre activo');

      const courseCache = new Map<string, string>();
      for (const row of rows) {
        const normalizedDay = this.normalizeDay(row.day);
        const block = row.block.trim().toUpperCase();
        if (!BLOCKS.has(block)) throw new BadRequestException(`Bloque inválido: ${row.block}`);

        let courseId = courseCache.get(`${row.nrc}|${row.subjectName}`);
        if (!courseId) {
          const assignment = await transaction.teachingAssignment.findFirst({
            where: { semesterId: semester.id, nrc: row.nrc },
            select: { courseId: true },
          });
          if (assignment) courseId = assignment.courseId;
          else {
            const course = await transaction.course.upsert({
              where: { code_name: { code: row.nrc, name: row.subjectName } },
              update: {},
              create: { code: row.nrc, name: row.subjectName },
              select: { id: true },
            });
            courseId = course.id;
          }
          courseCache.set(`${row.nrc}|${row.subjectName}`, courseId);
        }

        await transaction.courseSchedule.upsert({
          where: { semesterId_nrc_day_block: { semesterId: semester.id, nrc: row.nrc, day: normalizedDay, block } },
          update: { courseId },
          create: { semesterId: semester.id, courseId, nrc: row.nrc, day: normalizedDay, block },
        });
      }

      return { semesterId: semester.id, importedRows: rows.length };
    });
  }

  private parseCsv(csv: string): TeacherImportRow[] {
    const lines = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) return [];
    const headers = this.splitCsvLine(lines[0]).map((header) => header.trim());
    const required = ['teacherEmail', 'teacherName', 'courseCode', 'courseName', 'nrc', 'semesterName', 'startsOn', 'endsOn'];
    for (const key of required) if (!headers.includes(key)) throw new BadRequestException(`Falta la columna ${key}`);
    return lines.slice(1).map((line) => {
      const values = this.splitCsvLine(line);
      const row = Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ''])) as Partial<TeacherImportRow>;
      if (!row.teacherEmail || !row.teacherName || !row.courseCode || !row.courseName || !row.nrc || !row.semesterName) throw new BadRequestException('Hay una fila incompleta en el CSV');
      return row as TeacherImportRow;
    });
  }

  private splitCsvLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let quoted = false;
    for (const character of line) {
      if (character === '"') quoted = !quoted;
      else if ((character === ',' || character === ';') && !quoted) { values.push(current); current = ''; }
      else current += character;
    }
    values.push(current);
    return values;
  }

  private parseCourseScheduleCsv(csv: string): CourseScheduleImportRow[] {
    const lines = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) return [];
    const headers = this.splitCsvLine(lines[0]).map((header) => this.normalizeHeader(header));
    const required = ['nrc', 'asignatura', 'dia', 'bloque'];
    for (const key of required) if (!headers.includes(key)) throw new BadRequestException(`Falta la columna ${key}`);
    return lines.slice(1).map((line) => {
      const values = this.splitCsvLine(line);
      const row = Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? '']));
      if (!row.nrc || !row.asignatura || !row.dia || !row.bloque) throw new BadRequestException('Hay una fila incompleta en el CSV de asignaturas');
      return { nrc: row.nrc, subjectName: row.asignatura, day: row.dia, block: row.bloque };
    });
  }

  private normalizeHeader(value: string): string {
    return value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  private normalizeDay(value: string): string {
    const normalized = this.normalizeHeader(value);
    const day = DAYS.get(normalized);
    if (!day) throw new BadRequestException(`Día inválido: ${value}`);
    return day;
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`Fecha inválida: ${value}`);
    return date;
  }
}
