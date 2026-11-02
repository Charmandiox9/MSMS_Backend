import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getTerms, CURRENT_TERMS_VERSION } from './terms-content';

@Injectable()
export class TermsService {
  constructor(private readonly prisma: PrismaService) {}

  private async withStorageCheck<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2021'
      ) {
        throw new ServiceUnavailableException({
          code: 'TERMS_STORAGE_NOT_INITIALIZED',
          message:
            'La base de datos aún no tiene la migración de términos. En MSMS_Backend ejecuta npx prisma migrate dev y reinicia el servidor.',
        });
      }
      throw error;
    }
  }

  getCurrent(locale: string) {
    return getTerms(locale);
  }

  async getStatus(userId: string) {
    const acceptance = await this.withStorageCheck(() =>
      this.prisma.legalTermsAcceptance.findUnique({
        where: {
          userId_version: { userId, version: CURRENT_TERMS_VERSION },
        },
        select: { version: true, acceptedAt: true },
      }),
    );

    return {
      currentVersion: CURRENT_TERMS_VERSION,
      accepted: Boolean(acceptance),
      acceptedAt: acceptance?.acceptedAt ?? null,
    };
  }

  async accept(userId: string, version: string, locale: string) {
    if (version !== CURRENT_TERMS_VERSION) {
      throw new ConflictException({
        code: 'TERMS_VERSION_OUTDATED',
        currentVersion: CURRENT_TERMS_VERSION,
      });
    }
    const document = getTerms(locale, version);
    if (!document) throw new NotFoundException('Documento legal no encontrado');

    try {
      return await this.withStorageCheck(() =>
        this.prisma.legalTermsAcceptance.create({
          data: {
            userId,
            version,
            locale: document.locale,
            contentHash: document.contentHash,
            contentSnapshot: {
              title: document.title,
              notice: document.notice,
              sections: document.sections,
            },
          },
          select: { version: true, locale: true, contentHash: true, contentSnapshot: true, acceptedAt: true },
        }),
      );
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        const existing = await this.withStorageCheck(() =>
          this.prisma.legalTermsAcceptance.findUnique({
            where: { userId_version: { userId, version } },
            select: { version: true, locale: true, contentHash: true, contentSnapshot: true, acceptedAt: true },
          }),
        );
        if (existing) return existing;
      }
      throw error;
    }
  }

  async getHistory(userId: string) {
    return this.withStorageCheck(() =>
      this.prisma.legalTermsAcceptance.findMany({
        where: { userId },
        orderBy: { acceptedAt: 'desc' },
        select: { version: true, locale: true, contentHash: true, contentSnapshot: true, acceptedAt: true },
      }),
    );
  }

  async hasAcceptedCurrentVersion(userId: string) {
    const acceptance = await this.withStorageCheck(() =>
      this.prisma.legalTermsAcceptance.findUnique({
        where: {
          userId_version: { userId, version: CURRENT_TERMS_VERSION },
        },
        select: { id: true },
      }),
    );
    return Boolean(acceptance);
  }
}
