import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ListTeachersQueryDto,
  TEACHERS_DEFAULT_PAGE_SIZE,
} from './list-teachers-query.dto';

// Los query params llegan siempre como texto, igual que en la petición HTTP.
async function parse(query: Record<string, unknown>) {
  const dto = plainToInstance(ListTeachersQueryDto, query);
  return { dto, errors: await validate(dto) };
}

describe('ListTeachersQueryDto', () => {
  it('usa la primera página y el tamaño por defecto sin parámetros', async () => {
    const { dto, errors } = await parse({});

    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.pageSize).toBe(TEACHERS_DEFAULT_PAGE_SIZE);
    expect(dto.search).toBeUndefined();
    expect(dto.isActive).toBeUndefined();
  });

  it('convierte page, pageSize, search e isActive desde texto', async () => {
    const { dto, errors } = await parse({
      page: '3',
      pageSize: '25',
      search: '  Ana  ',
      isActive: 'false',
    });

    expect(errors).toHaveLength(0);
    expect(dto).toEqual(
      expect.objectContaining({
        page: 3,
        pageSize: 25,
        search: 'Ana',
        isActive: false,
      }),
    );
  });

  it.each([
    ['page cero', { page: '0' }],
    ['page no numérica', { page: 'abc' }],
    ['page decimal', { page: '1.5' }],
    ['pageSize sobre el máximo', { pageSize: '101' }],
    ['isActive inválido', { isActive: 'yes' }],
    ['search demasiado largo', { search: 'a'.repeat(101) }],
  ])('rechaza %s', async (_case, query) => {
    const { errors } = await parse(query);

    expect(errors).toHaveLength(1);
  });
});
