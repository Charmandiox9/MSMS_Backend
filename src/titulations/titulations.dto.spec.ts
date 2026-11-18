import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTitulationDto } from './titulations.dto';

const CAREER_ID = '11111111-1111-4111-8111-111111111111';

async function errorsFor(input: Record<string, unknown>) {
  const dto = plainToInstance(CreateTitulationDto, input);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

describe('CreateTitulationDto', () => {
  it('accepts the minimum record while optional source data is missing', async () => {
    await expect(
      errorsFor({ studentName: 'Nombre Apellido', careerId: CAREER_ID }),
    ).resolves.toHaveLength(0);
  });

  it('normalizes blank optional values to null', async () => {
    const dto = plainToInstance(CreateTitulationDto, {
      studentName: 'Nombre Apellido',
      careerId: CAREER_ID,
      studentRut: '   ',
      studentEmail: '  ',
      thesisTopic: '  ',
    });

    expect(dto.studentRut).toBeNull();
    expect(dto.studentEmail).toBeNull();
    expect(dto.thesisTopic).toBeNull();
    await expect(
      validate(dto, { whitelist: true, forbidNonWhitelisted: true }),
    ).resolves.toHaveLength(0);
  });

  it.each([
    ['studentRut', '12.345.678-0'],
    ['studentEmail', 'not-an-email'],
    ['studentPhone', 'phone'],
    ['defenseDate', '31-02-2025'],
  ])('rejects invalid %s values', async (field, value) => {
    const errors = await errorsFor({
      studentName: 'Nombre Apellido',
      careerId: CAREER_ID,
      [field]: value,
    });

    expect(errors.map((error) => error.property)).toContain(field);
  });

  it('rejects a career outside the preloaded catalog contract', async () => {
    const errors = await errorsFor({
      studentName: 'Nombre Apellido',
      careerName: 'Carrera ingresada manualmente',
    });

    expect(errors.map((error) => error.property)).toContain('careerId');
    expect(errors.map((error) => error.property)).toContain('careerName');
  });
});
