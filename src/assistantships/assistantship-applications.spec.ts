import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { PiiStorageCodec } from '../privacy/pii-storage-codec';
import { testPiiCrypto } from '../privacy/pii-test-config';
import { AssistantshipApplicationsController } from './assistantship-applications.controller';
import {
  AssistantshipApplicationDecisionDto,
  AssistantshipApplicationSubmissionDto,
} from './assistantship-applications.dto';
import { AssistantshipApplicationsService } from './assistantship-applications.service';
import { AssistantshipsGuard } from './assistantships.guard';

const form = {
  externalResponseId: 'form:response',
  studentEmail: ' Alumna@example.test ',
  name: 'Persona de prueba',
  rut: '12.345.678-5',
  phone: '+56 9 5555 0202',
  submittedCareer: 'Programa académico',
  address: 'Dirección de prueba',
  subject: 'Asignatura de prueba',
  motivation: 'Apoyar a estudiantes.',
  ppa: '5,80',
  submittedAt: '2026-11-19T12:00:00.000Z',
};

describe('Postulaciones de ayudantía', () => {
  const app = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  };
  const student = { findUnique: jest.fn() };
  const send = jest.fn();
  const config = new ConfigService({
    ASSISTANTSHIP_FORMS_WEBHOOK_SECRET: 'forms-secret-test',
    RESEND_API_KEY: 'test',
    NOTIFICATIONS_FROM: 'from@example.test',
  });
  const service = new AssistantshipApplicationsService(
    { assistantshipApplication: app, student } as unknown as PrismaService,
    { send } as unknown as NotificationsService,
    config,
  );
  const controller = new AssistantshipApplicationsController(service, config);
  const linked = {
    id: 'student-1',
    name: 'Registro académico',
    email: 'alumna@example.test',
    career: null,
  };

  beforeEach(() => {
    jest.resetAllMocks();
    student.findUnique.mockResolvedValue(linked);
    app.findUnique.mockResolvedValue({
      id: 'app',
      studentEmail: 'alumna@example.test',
      student: null,
    });
    app.updateMany.mockResolvedValue({ count: 1 });
  });

  it('protects the webhook and deduplicates retries with a normalized student link', async () => {
    expect(() => controller.receive('bad', form)).toThrow(
      UnauthorizedException,
    );
    expect(app.create).not.toHaveBeenCalled();
    await expect(
      controller.receive('forms-secret-test', form),
    ).resolves.toEqual({ received: true, duplicate: false });
    expect(student.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'alumna@example.test' } }),
    );
    expect(app.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          studentId: linked.id,
          submittedAt: new Date(form.submittedAt),
        }),
      }),
    );
    app.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(
      controller.receive('forms-secret-test', form),
    ).resolves.toMatchObject({ duplicate: true });
  });

  it('requires management permission for list, details and decisions', () => {
    for (const handler of [
      controller.list,
      controller.detail,
      controller.decide,
    ])
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(
        AssistantshipsGuard,
      );
    expect(() =>
      controller.decide(
        'app',
        { status: 'APPROVED', notify: false },
        undefined,
      ),
    ).toThrow(UnauthorizedException);
  });

  it('validates form values without coercing the notification checkbox', async () => {
    expect(
      await validate(
        plainToInstance(AssistantshipApplicationSubmissionDto, form),
      ),
    ).toHaveLength(0);
    const errors = await validate(
      plainToInstance(AssistantshipApplicationSubmissionDto, {
        ...form,
        rut: 'no',
        phone: '---...---',
        ppa: '5.999',
        motivation: '  ',
      }),
    );
    expect(errors.map(({ property }) => property)).toEqual(
      expect.arrayContaining(['rut', 'phone', 'ppa', 'motivation']),
    );
    expect(
      await validate(
        plainToInstance(AssistantshipApplicationDecisionDto, {
          status: 'PENDING',
          notify: 'false',
        }),
      ),
    ).toHaveLength(2);
  });

  it('encrypts the response including the address, grade and note', () => {
    const codec = new PiiStorageCodec(testPiiCrypto());
    const input = { ...form, reviewNote: 'Nota privada' };
    const encrypted = codec.write('AssistantshipApplication', input);
    expect(encrypted).toMatchObject({
      piiVersion: 1,
      externalResponseIdHash: expect.any(String),
    });
    for (const field of [
      'name',
      'rut',
      'phone',
      'address',
      'ppa',
      'motivation',
      'reviewNote',
    ] as const)
      expect(encrypted).not.toHaveProperty(field, input[field]);
    expect(codec.read('AssistantshipApplication', encrypted)).toMatchObject(
      input,
    );
  });

  it('approves an application as an unregistered draft and records a successful email', async () => {
    await expect(
      service.decide('app', 'reviewer', { status: 'APPROVED', notify: true }),
    ).resolves.toMatchObject({ student: linked });
    expect(app.updateMany).toHaveBeenCalledWith({
      where: { id: 'app', status: 'PENDING' },
      data: {
        status: 'APPROVED',
        reviewedById: 'reviewer',
        reviewedAt: expect.any(Date),
        reviewNote: null,
        studentId: linked.id,
        notification: 'PENDING',
      },
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'alumna@example.test' }),
    );
    expect(app.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { notification: 'SENT' } }),
    );
  });

  it('does not send without consent and does not repeat a decision', async () => {
    await service.decide('app', 'reviewer', {
      status: 'REJECTED',
      notify: false,
    });
    expect(send).not.toHaveBeenCalled();
    app.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.decide('app', 'other', { status: 'APPROVED', notify: true }),
    ).rejects.toThrow(ConflictException);
    expect(send).not.toHaveBeenCalled();
  });

  it('preserves a rejection when the requested email fails', async () => {
    send.mockRejectedValueOnce(new Error('provider unavailable'));
    await service.decide('app', 'reviewer', {
      status: 'REJECTED',
      notify: true,
    });
    expect(app.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'REJECTED' }),
      }),
    );
    expect(app.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { notification: 'FAILED' } }),
    );
  });
});
