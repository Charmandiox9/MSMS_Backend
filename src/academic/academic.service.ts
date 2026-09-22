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

@Injectable()
export class AcademicService {
  constructor(private readonly prisma: PrismaService) {}

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
      else if (character === ',' && !quoted) { values.push(current); current = ''; }
      else current += character;
    }
    values.push(current);
    return values;
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`Fecha inválida: ${value}`);
    return date;
  }
}
