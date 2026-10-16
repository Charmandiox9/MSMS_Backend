import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WhitelistService {
  private readonly allowedDomains: string[];
  private readonly allowedEmails: string[];

  constructor(config: ConfigService) {
    this.allowedDomains = this.parseList(config.get<string>('ALLOWED_DOMAINS'));
    this.allowedEmails = this.parseList(config.get<string>('ALLOWED_EMAILS'));

    if (this.allowedDomains.length === 0 && this.allowedEmails.length === 0) {
      throw new Error(
        'Configuración inválida: ALLOWED_DOMAINS y ALLOWED_EMAILS no pueden estar ambas vacías. ' +
          'Define al menos una en el .env para no dejar la plataforma abierta.',
      );
    }
  }

  isEmailAllowed(email: string): boolean {
    const normalizedEmail = email.trim().toLowerCase();
    const domain = normalizedEmail.split('@')[1];

    return (
      this.allowedEmails.includes(normalizedEmail) ||
      (!!domain && this.allowedDomains.includes(domain))
    );
  }

  private parseList(raw?: string): string[] {
    if (!raw) return [];
    return raw
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
  }
}
