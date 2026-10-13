import { JustificationStatus } from '@prisma/client';
import { academicScheduleBlocks } from '../academic/schedule-blocks';
import type { NotificationMessage } from '../notifications/notifications.service';

export interface DecisionEmailDetails {
  id: string;
  status: JustificationStatus;
  studentEmail: string;
  subjectName: string;
  subjectCode: string | null;
  nrc: string | null;
  parallel: string | null;
  rejectionReason: string | null;
  reasonCategory?: string | null;
  absenceDate?: Date;
  decidedAt?: Date | null;
  absenceBlocks?: string[];
}

type Recipient = {
  email: string;
  name?: string;
  role: 'student' | 'teacher' | 'assistant';
};
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ] ?? character,
  );
const time = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/** Renders recipient-specific content without disclosing evidence or private reasons to staff. */
export function decisionEmail(
  details: DecisionEmailDetails,
  recipient: Recipient,
): NotificationMessage {
  const approved = details.status === JustificationStatus.ACCEPTED;
  const outcome = approved ? 'Aprobada' : 'Rechazada';
  const isStudent = recipient.role === 'student';
  const greeting = recipient.name ? `Hola, ${recipient.name}:` : 'Hola:';
  const introduction = isStudent
    ? `Tu justificación de inasistencia fue ${outcome.toLowerCase()}. A continuación encontrarás el detalle de la decisión.`
    : `Se aprobó la justificación de inasistencia de ${details.studentEmail}. Recibes este aviso como ${recipient.role === 'assistant' ? 'ayudante de la asignatura con horario coincidente con la inasistencia' : 'docente de la asignatura'}.`;
  const rows: [string, string][] = [
    ['Estado', outcome],
    ['Referencia de solicitud', details.id],
    ['Estudiante', details.studentEmail],
    ['Asignatura', details.subjectName],
  ];
  if (details.subjectCode)
    rows.push(['Código de asignatura', details.subjectCode]);
  if (details.nrc) rows.push(['NRC de asignatura', details.nrc]);
  if (details.parallel) rows.push(['Paralelo', details.parallel]);
  if (details.absenceDate)
    rows.push([
      'Fecha de inasistencia',
      `${new Intl.DateTimeFormat('es-CL', { weekday: 'long', timeZone: 'UTC' }).format(details.absenceDate)}, ${details.absenceDate.toISOString().slice(0, 10)}`,
    ]);
  rows.push([
    'Bloques declarados en el formulario',
    details.absenceBlocks?.length
      ? [...new Set(details.absenceBlocks)]
          .map((code) => {
            const block = academicScheduleBlocks.find(
              (item) => item.code === code,
            );
            return block
              ? `${code} (${time(block.startsAtMinute)}–${time(block.endsAtMinute)})`
              : code;
          })
          .join(', ')
      : approved
        ? 'No informados; el aviso a ayudantes considera todas las ayudantías de la asignatura de ese día.'
        : 'No informados.',
  ]);
  if (details.decidedAt)
    rows.push([
      'Fecha de resolución (hora de Chile)',
      new Intl.DateTimeFormat('es-CL', {
        dateStyle: 'long',
        timeStyle: 'short',
        timeZone: 'America/Santiago',
      }).format(details.decidedAt),
    ]);
  if (isStudent && !approved && details.rejectionReason)
    rows.push(['Motivo', details.rejectionReason]);
  const nextStep = isStudent
    ? approved
      ? 'La decisión quedó registrada en MARSYS. Esta resolución se comunica a los docentes asociados y, cuando corresponde, a los ayudantes con horario coincidente. Conserva este correo como referencia de tu solicitud.'
      : 'Revisa el motivo indicado. Si necesitas aclarar la decisión o aportar antecedentes, contacta a la Encargada de Apoyo Docente e indica la referencia de solicitud.'
    : 'Considera esta resolución al revisar la inasistencia del estudiante en la asignatura. Este aviso no incluye documentos de respaldo ni antecedentes personales de la solicitud.';
  const footer =
    'MARSYS · Facultad de Ciencias del Mar · Universidad Católica del Norte\nNotificación automática sobre una justificación de inasistencia.';
  const title = `Justificación de inasistencia ${outcome.toLowerCase()}`;
  return {
    to: recipient.email,
    subject:
      `[MARSYS] ${outcome}: ${details.subjectName}${details.nrc ? ` · NRC ${details.nrc}` : ''}`.replace(
        /[\r\n]+/g,
        ' ',
      ),
    text: [
      greeting,
      introduction,
      rows.map(([label, value]) => `${label}: ${value}`).join('\n'),
      nextStep,
      footer,
    ].join('\n\n'),
    html: `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#edf3f8;color:#172b42;font-family:Arial,sans-serif"><table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:24px 12px"><table role="presentation" style="width:100%;max-width:640px;margin:auto;background:#ffffff;border-collapse:collapse"><tr><td style="padding:24px;background:#12334f;color:#ffffff"><strong style="font-size:24px">MARSYS</strong><p style="margin:8px 0 0">Justificaciones de inasistencia</p></td></tr><tr><td style="padding:24px"><h1 style="font-size:22px;color:${approved ? '#08766d' : '#a43b32'}">${escapeHtml(title)}</h1><p>${escapeHtml(greeting)}</p><p style="line-height:1.6">${escapeHtml(introduction)}</p><table style="width:100%;border-collapse:collapse">${rows.map(([label, value]) => `<tr><th scope="row" style="padding:12px 8px;text-align:left;vertical-align:top;border-bottom:1px solid #dce5ed;font-size:14px;width:38%">${escapeHtml(label)}</th><td style="padding:12px 8px;border-bottom:1px solid #dce5ed;font-size:14px;overflow-wrap:anywhere;white-space:pre-line">${escapeHtml(value)}</td></tr>`).join('')}</table><p style="line-height:1.6;padding:16px;background:#edf6f5">${escapeHtml(nextStep)}</p></td></tr><tr><td style="padding:20px 24px;background:#edf3f8;font-size:12px;line-height:1.6">${escapeHtml(footer).replace(/\n/g, '<br>')}</td></tr></table></td></tr></table></body></html>`,
  };
}
