import { JustificationStatus } from '@prisma/client';
import { decisionEmail, DecisionEmailDetails } from './decision-email';

describe('Decision emails', () => {
  const details: DecisionEmailDetails = {
    id: 'solicitud-123',
    status: JustificationStatus.ACCEPTED,
    studentEmail: 'estudiante@example.test',
    subjectName: 'Oceanografía',
    subjectCode: 'OC-101',
    nrc: '10001',
    parallel: '1',
    absenceDate: new Date('2026-09-23'),
    absenceBlocks: ['A'],
    decidedAt: new Date('2026-09-24T12:00:00Z'),
    rejectionReason: null,
  };
  it('includes traceability, local decision time and explicit block hours in HTML and text', () => {
    const email = decisionEmail(details, {
      email: details.studentEmail,
      role: 'student',
    });
    for (const content of [email.text, email.html]) {
      for (const value of [
        'solicitud-123',
        'Oceanografía',
        '10001',
        'OC-101',
        '2026-09-23',
        '08:10–09:40',
        '9:00',
      ])
        expect(content).toContain(value);
    }
    expect(email.subject).toBe('[MARSYS] Aprobada: Oceanografía · NRC 10001');
    expect(email.text).toContain('Conserva este correo');
  });
  it('explains the rejection and next step only to the student', () => {
    const rejected = {
      ...details,
      status: JustificationStatus.REJECTED,
      rejectionReason: 'Documento ilegible',
    };
    const email = decisionEmail(rejected, {
      email: details.studentEmail,
      role: 'student',
    });
    expect(email.text).toContain('Motivo: Documento ilegible');
    expect(email.html).toContain('Documento ilegible');
    expect(email.text).toContain('Encargada de Apoyo Docente');
    expect(email.subject).toContain('Rechazada');
  });
  it.each(['teacher', 'assistant'] as const)(
    'personalizes %s notices without disclosing private reasons',
    (role) => {
      const email = decisionEmail(
        {
          ...details,
          rejectionReason: 'Información privada',
          reasonCategory: 'MEDICAL',
        },
        { email: 'recipient@example.test', name: 'Ana', role },
      );
      expect(email.text).toContain('Hola, Ana:');
      expect(email.text).toContain(
        role === 'teacher'
          ? 'docente de la asignatura'
          : 'ayudante de la asignatura',
      );
      expect(email.text).not.toContain('Información privada');
      expect(email.html).not.toContain('MEDICAL');
    },
  );
  it('makes date-only scope explicit rather than inferring blocks', () => {
    const email = decisionEmail(
      {
        ...details,
        absenceBlocks: [],
        nrc: null,
        parallel: null,
        subjectCode: null,
      },
      { email: 'helper@example.test', role: 'assistant' },
    );
    expect(email.text).toContain(
      'todas las ayudantías de la asignatura de ese día',
    );
    expect(email.text).not.toContain('08:10');
    expect(email.text).not.toContain('NRC de asignatura:');
  });
  it('escapes every user value in HTML, preserving literal text and removing subject newlines', () => {
    const email = decisionEmail(
      {
        ...details,
        subjectName: '<img src=x onerror=alert(1)>\r\nAsignatura',
        status: JustificationStatus.REJECTED,
        rejectionReason: '<script>"&\'</script>',
      },
      {
        email: details.studentEmail,
        name: '<b>Estudiante</b>',
        role: 'student',
      },
    );
    expect(email.html).not.toContain('<script>');
    expect(email.html).not.toContain('<img');
    expect(email.html).toContain('&lt;script&gt;&quot;&amp;&#39;');
    expect(email.html).toContain('&lt;b&gt;Estudiante&lt;/b&gt;');
    expect(email.text).toContain('<script>');
    expect(email.subject).not.toMatch(/[\r\n]/);
  });
});
