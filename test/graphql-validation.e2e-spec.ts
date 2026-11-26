import request from 'supertest';
import { createTestApp, type TestApp } from './support/test-app';

describe('GraphQL input validation', () => {
  const assignments = jest.fn().mockResolvedValue([]);
  const students = jest.fn().mockResolvedValue([]);
  const list = jest.fn();
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp({
      assistantships: { assignments, students, list },
    });
  });

  afterAll(async () => ctx.close());
  beforeEach(() => jest.clearAllMocks());

  function graphql(query: string) {
    return request(ctx.app.getHttpServer())
      .post('/api/graphql')
      .set('Cookie', ctx.cookieFor('coordinator'))
      .send({ query })
      .expect(200);
  }

  it.each([
    [
      '{ assistantshipAssignments(semesterId: "invalid") { id } }',
      'semesterId must be a UUID',
    ],
    [
      '{ assistantshipStudents(search: "a") { id } }',
      'search must be longer than or equal to 2 characters',
    ],
    [
      '{ assistantships(filters: { page: 0 }) { total } }',
      'page must not be less than 1',
    ],
  ])(
    'rejects invalid input before invoking the service',
    async (query, message) => {
      const { body } = await graphql(query);
      expect(JSON.stringify(body.errors)).toContain(message);
      expect(assignments).not.toHaveBeenCalled();
      expect(students).not.toHaveBeenCalled();
      expect(list).not.toHaveBeenCalled();
    },
  );

  it('passes a valid UUID to the service', async () => {
    const id = '123e4567-e89b-42d3-a456-426614174000';
    const { body } = await graphql(
      `{ assistantshipAssignments(semesterId: "${id}") { id } }`,
    );
    expect(body).toEqual({ data: { assistantshipAssignments: [] } });
    expect(assignments).toHaveBeenCalledWith(id);
  });
});
