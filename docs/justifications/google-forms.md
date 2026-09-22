# Integración de Google Forms con justificativos

Esta guía configura el formulario, su hoja de respuestas, un Apps Script que sube los archivos a Cloudflare R2 y envía las respuestas al backend de MARSYS.

## Flujo

```text
Google Form → hoja de respuestas → Apps Script
                                  ├─ solicita URL firmada al backend
                                  ├─ sube el archivo directamente a R2
                                  └─ registra la respuesta en el inbox
```

El backend expone `POST /api/storage/presigned-upload/forms` y `POST /api/justifications/inbox`. Ambas rutas requieren el secreto configurado en `GOOGLE_FORMS_WEBHOOK_SECRET`. El script usa el encabezado `x-marsys-forms-secret`.

## 1. Configurar el backend

1. Despliega el backend en una URL HTTPS pública. Apps Script no puede acceder a `localhost` ni a una red privada.
2. Configura las variables R2 documentadas en `backend/.env.example`: `STORAGE_PROVIDER="r2"`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` y `R2_BUCKET_NAME`. El endpoint y la expiración de URL firmada son configurables allí también.
3. Genera un secreto largo y aleatorio y configúralo como `GOOGLE_FORMS_WEBHOOK_SECRET` en el entorno del backend. No reutilices una contraseña personal.
4. Asegúrate de que el backend tenga la base de datos y migraciones vigentes.

## 2. Crear el formulario

Usa una cuenta institucional responsable del formulario y crea uno llamado, por ejemplo, **Justificación de inasistencia**. Configura la recopilación de correo verificado y, si corresponde a la política institucional, restringe las respuestas a cuentas de la institución. No solicites contraseñas ni datos que el proceso no necesite.

Agrega estas preguntas. Los títulos deben coincidir con los encabezados de la hoja o actualizarse en `CONFIG` en el script:

| Pregunta | Tipo / configuración | Uso |
| --- | --- | --- |
| Dirección de correo electrónico | Recopilación automática de correo verificado | Identifica a la persona; no agregues una pregunta de texto para este dato. |
| Día que faltó | Fecha | Se guarda como `absenceDate`. |
| Clase que faltó | Lista desplegable, opciones con formato `NRC - Nombre de asignatura` | El NRC identifica la clase y el nombre permite asociarla si no se encuentra una asignación activa. |
| Adjunte el justificante | Subir archivo; PDF, JPG o PNG; un archivo | El archivo se copia desde Drive a R2. |
| Motivo o comentario | Párrafo, opcional | Se guarda como `reason`. |

La pregunta de carga de archivos exige que la persona responda con una cuenta Google. Google Forms conserva inicialmente esos archivos en el Drive del propietario; la cuenta que instala el trigger debe poder acceder a ellos. Mantén actualizada la lista de clases al cambiar la carga académica.

## 3. Vincular la hoja de cálculo

En el formulario abre **Respuestas → Vincular a Hojas de cálculo**, crea una hoja nueva y conserva la fila de encabezados generada por Forms. Verifica que los encabezados de fecha, clase, archivo y comentario correspondan a los de la tabla anterior. El texto del encabezado del correo varía según el idioma de Forms (por ejemplo, `Dirección de correo electrónico` o `Email Address`); copia el texto exacto en la configuración del script.

Desde esa hoja abre **Extensiones → Apps Script**. El proyecto quedará asociado a la hoja que recibe las respuestas.

## 4. Configurar Apps Script

En Apps Script, abre **Configuración del proyecto → Propiedades del script** y agrega:

| Propiedad | Valor |
| --- | --- |
| `MARSYS_API_BASE_URL` | URL HTTPS del backend, incluyendo `/api` y sin `/` final; por ejemplo `https://api.ejemplo.cl/api`. |
| `GOOGLE_FORMS_WEBHOOK_SECRET` | El mismo secreto que `GOOGLE_FORMS_WEBHOOK_SECRET` del backend. |

Guarda el proyecto y establece su zona horaria en **Configuración del proyecto → Zona horaria → (GMT-04:00) Santiago** (o la zona institucional vigente). El secreto debe quedar solo en las propiedades protegidas del proyecto y en el gestor de secretos del backend; no lo escribas en el código, la hoja, el formulario ni los logs. Limita el acceso de edición al proyecto a sus operadores.

Pega el siguiente código en `Code.gs`. Ajusta los valores de `CONFIG` a los encabezados exactos de la primera fila de la hoja si Forms los generó con otro idioma o puntuación.

```javascript
const CONFIG = {
  emailHeader: 'Dirección de correo electrónico',
  absenceDateHeader: 'Día que faltó',
  subjectHeader: 'Clase que faltó',
  evidenceHeader: 'Adjunte el justificante',
  reasonHeader: 'Motivo o comentario',
};

function handleFormSubmit(event) {
  if (!event || !event.range) {
    throw new Error('Esta función debe ejecutarse mediante el trigger de envío del formulario.');
  }

  const sheet = event.range.getSheet();
  const rowNumber = event.range.getRow();
  const lastColumn = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  const values = sheet.getRange(rowNumber, 1, 1, lastColumn).getValues()[0];
  const answers = Object.fromEntries(
    headers.map((header, index) => [header.trim(), values[index]])
  );

  const properties = PropertiesService.getScriptProperties();
  const baseUrl = (properties.getProperty('MARSYS_API_BASE_URL') || '').replace(/\/+$/, '');
  const secret = properties.getProperty('GOOGLE_FORMS_WEBHOOK_SECRET');
  if (!baseUrl || !secret) {
    throw new Error('Configura MARSYS_API_BASE_URL y GOOGLE_FORMS_WEBHOOK_SECRET en las propiedades del script.');
  }

  const studentEmail = requiredText_(answers[CONFIG.emailHeader], CONFIG.emailHeader);
  const submittedDate = answers[CONFIG.absenceDateHeader];
  if (!(submittedDate instanceof Date) || Number.isNaN(submittedDate.getTime())) {
    throw new Error('La fecha de inasistencia no es válida; revisa el encabezado y el tipo de pregunta.');
  }
  const absenceDate = Utilities.formatDate(
    submittedDate,
    Session.getScriptTimeZone(),
    'yyyy-MM-dd'
  );

  const subjectValue = requiredText_(answers[CONFIG.subjectHeader], CONFIG.subjectHeader);
  const separatorIndex = subjectValue.indexOf(' - ');
  const nrc = (separatorIndex < 0 ? subjectValue : subjectValue.slice(0, separatorIndex)).trim();
  const subjectName = separatorIndex < 0 ? '' : subjectValue.slice(separatorIndex + 3).trim();
  if (!nrc) throw new Error('La opción de clase debe comenzar con el NRC.');

  const evidenceLink = requiredText_(answers[CONFIG.evidenceHeader], CONFIG.evidenceHeader);
  const fileIdMatch = evidenceLink.match(/[-\w]{25,}/);
  if (!fileIdMatch) throw new Error('No se encontró un identificador válido para el archivo de Drive.');

  const file = DriveApp.getFileById(fileIdMatch[0]);
  const contentType = file.getMimeType();
  if (!['application/pdf', 'image/jpeg', 'image/png'].includes(contentType)) {
    throw new Error('El archivo debe ser PDF, JPG o PNG.');
  }

  const presigned = postJson_(
    baseUrl + '/storage/presigned-upload/forms',
    secret,
    { fileName: file.getName(), contentType: contentType }
  );
  if (!presigned.key || !presigned.uploadUrl) {
    throw new Error('El backend no devolvió la clave y URL firmada para el archivo.');
  }

  const uploadResponse = UrlFetchApp.fetch(presigned.uploadUrl, {
    method: 'put',
    contentType: contentType,
    payload: file.getBlob().getBytes(),
    muteHttpExceptions: true,
  });
  assertSuccess_(uploadResponse, 'subida del archivo a R2');

  const externalResponseId = [
    SpreadsheetApp.getActive().getId(),
    sheet.getSheetId(),
    rowNumber,
  ].join('-');

  postJson_(baseUrl + '/justifications/inbox', secret, {
    externalResponseId: externalResponseId,
    studentEmail: studentEmail,
    absenceDate: absenceDate,
    subjectName: subjectName || undefined,
    nrc: nrc,
    reason: optionalText_(answers[CONFIG.reasonHeader]),
    evidenceKey: presigned.key,
    evidenceContentType: contentType,
  });
}

function postJson_(url, secret, body) {
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-marsys-forms-secret': secret },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  assertSuccess_(response, 'solicitud al backend');
  return JSON.parse(response.getContentText());
}

function assertSuccess_(response, operation) {
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    // No registrar el payload, el secreto ni la URL firmada: pueden contener datos sensibles.
    throw new Error('Falló la ' + operation + ' (HTTP ' + status + '). Revisa las ejecuciones del script y la configuración del backend.');
  }
}

function requiredText_(value, fieldName) {
  const text = value instanceof Date ? '' : String(value == null ? '' : value).trim();
  if (!text) throw new Error('Falta el campo requerido: ' + fieldName + '.');
  return text;
}

function optionalText_(value) {
  const text = String(value == null ? '' : value).trim();
  return text || undefined;
}
```

## 5. Instalar el trigger

En Apps Script, abre **Desencadenadores (icono de reloj) → Añadir desencadenador** y configura:

- Función: `handleFormSubmit`.
- Implementación: `Head`.
- Fuente del evento: **Hoja de cálculo**.
- Tipo de evento: **Al enviar formulario**.

Guarda y autoriza los permisos que Google solicite para leer los archivos de Drive y realizar solicitudes HTTP externas. Instala el trigger con una cuenta institucional que mantenga acceso al formulario, la hoja y los archivos. No ejecutes `handleFormSubmit` manualmente: necesita el evento que entrega Forms. Evita crear triggers duplicados.

## 6. Probar y verificar

1. Envía una respuesta de prueba con una cuenta autorizada, una fecha, una clase con NRC y un archivo PDF/JPG/PNG.
2. En Apps Script revisa **Ejecuciones**: `handleFormSubmit` debe terminar correctamente.
3. Confirma que el backend respondió a las tres operaciones: solicitud de URL firmada, carga `PUT` a R2 y registro del inbox.
4. Verifica que el elemento aparezca en el inbox de justificativos. El registro inicial queda sin leer (`UNREAD`); al abrirlo desde la aplicación se procesa según el flujo de justificativos.
5. El identificador externo se deriva del ID de la hoja, la pestaña y el número de fila. Si se reintenta una respuesta, el backend puede reconocerla de forma idempotente.

## Diagnóstico

| Síntoma | Revisión |
| --- | --- |
| HTTP 401/403 | Comprueba que el secreto del backend y la propiedad del script coincidan y que el encabezado se envíe como `x-marsys-forms-secret`. |
| HTTP 400 al registrar | Revisa encabezados en `CONFIG`, correo, fecha, NRC y que se haya enviado `evidenceKey`/`evidenceContentType`. El backend requiere fecha y correo válidos, NRC, clave y tipo de contenido. |
| HTTP 400 por clase/asignatura | Confirma que el NRC sea correcto y que `subjectName` venga de una opción `NRC - Nombre`; verifica la carga académica activa. |
| HTTP 503 al pedir URL | Verifica `STORAGE_PROVIDER="r2"` y las credenciales/nombre del bucket R2 en el entorno del backend. |
| Error al subir a R2 | Confirma que el enlace firmado no expiró y que el `Content-Type` del `PUT` es idéntico al solicitado al backend. El límite de vigencia se configura con `R2_PRESIGNED_URL_EXPIRES_IN`. |
| No se ejecuta Apps Script | Comprueba que el trigger use la hoja vinculada y el evento **Al enviar formulario**, y revisa si la cuenta propietaria perdió acceso a Drive. |

No registres en los logs respuestas completas, correos, enlaces de Drive, secretos ni URLs firmadas. Si la subida a R2 resulta correcta pero falla el registro del inbox, la respuesta del Form puede reintentarse; revisa si quedó un archivo huérfano en R2 antes de eliminarlo.
