import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface NotificationMessage {
  to: string;
  subject: string;
  text: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly configService: ConfigService) {}

  async send(message: NotificationMessage): Promise<void> {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    const from = this.configService.get<string>('NOTIFICATIONS_FROM');

    if (!apiKey || !from) {
      this.logger.warn(
        `Notificación no enviada: configura RESEND_API_KEY y NOTIFICATIONS_FROM. Destinatario: ${message.to}`,
      );
      return;
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text }),
    });

    if (!response.ok) {
      throw new Error(`No se pudo enviar la notificación (${response.status})`);
    }
  }
}
