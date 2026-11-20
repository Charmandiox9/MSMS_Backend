const ASSISTANTSHIP_QUESTIONS = [
  ['name', 'Nombre', false],
  ['rut', 'RUT', false],
  ['phone', 'Teléfono', false],
  ['submittedCareer', 'Carrera', false],
  ['address', 'Dirección', false],
  ['subject', 'Asignatura a la que postula como ayudante', false],
  ['motivation', 'Motivación', true],
  ['ppa', 'PPA', false],
];

function obtenerFormularioPostulaciones_() {
  const activeForm = FormApp.getActiveForm();
  if (activeForm) return activeForm;

  const id = (PropertiesService.getScriptProperties().getProperty('MARSYS_ASSISTANTSHIP_FORM_ID') || '').trim();
  if (!id) throw new Error('Abre Apps Script desde el formulario o configura MARSYS_ASSISTANTSHIP_FORM_ID con el ID de su URL de edición.');
  return FormApp.openById(id);
}

function prepararFormularioVacio() {
  const form = obtenerFormularioPostulaciones_();
  if (form.getItems().length) throw new Error('Esta función requiere un formulario vacío.');
  form.setTitle('Postulación de ayudantía');
  form.setCollectEmail(true);
  for (const [, title, paragraph] of ASSISTANTSHIP_QUESTIONS) {
    const item = paragraph ? form.addParagraphTextItem() : form.addTextItem();
    item.setTitle(title).setRequired(true);
    if (title === 'RUT') item.setHelpText('Usa dígito verificador, por ejemplo 12345678-5.');
    if (title === 'PPA') item.setHelpText('Ingresa tu promedio con hasta dos decimales, por ejemplo 5,80.');
  }
}

function instalarTriggerPostulaciones() {
  const form = obtenerFormularioPostulaciones_();
  if (!form.collectsEmail()) throw new Error('Activa la recopilación de correo verificado en Forms.');
  const exists = ScriptApp.getProjectTriggers().some((trigger) =>
    trigger.getHandlerFunction() === 'enviarPostulacion' &&
    trigger.getTriggerSourceId() === form.getId() &&
    trigger.getEventType() === ScriptApp.EventType.ON_FORM_SUBMIT
  );
  if (!exists) ScriptApp.newTrigger('enviarPostulacion').forForm(form).onFormSubmit().create();
}

function enviarPostulacion(event) {
  if (!event || !event.response) throw new Error('Usa el activador instalado del formulario.');
  entregarPostulacion_(event.source, event.response);
}

function reenviarPostulacionPorId() {
  const id = PropertiesService.getScriptProperties().getProperty('MARSYS_RETRY_RESPONSE_ID');
  if (!id) throw new Error('Configura MARSYS_RETRY_RESPONSE_ID con el ID de la respuesta a reenviar.');
  const form = obtenerFormularioPostulaciones_();
  entregarPostulacion_(form, form.getResponse(id));
}

function entregarPostulacion_(form, response) {
  const properties = PropertiesService.getScriptProperties();
  const baseUrl = (properties.getProperty('MARSYS_API_BASE_URL') || '').trim().replace(/\/+$/, '');
  const secret = (properties.getProperty('ASSISTANTSHIP_FORMS_WEBHOOK_SECRET') || '').trim();
  if (!baseUrl.startsWith('https://') || !secret)
    throw new Error('Configura la URL HTTPS y el secreto de postulaciones.');
  if (!response.getId() || !response.getRespondentEmail())
    throw new Error('Se requiere el ID de respuesta y el correo recopilado por Forms.');

  const answers = Object.fromEntries(
    response.getItemResponses().map((item) => [item.getItem().getTitle().trim(), item.getResponse()])
  );
  const payload = {
    externalResponseId: form.getId() + ':' + response.getId(),
    studentEmail: response.getRespondentEmail(),
    submittedAt: response.getTimestamp().toISOString(),
  };
  for (const [field, title] of ASSISTANTSHIP_QUESTIONS) {
    if (typeof answers[title] !== 'string' || !answers[title].trim())
      throw new Error('Falta la respuesta a ' + title + '. Revisa el título de la pregunta.');
    payload[field] = answers[title].trim();
  }
  const result = UrlFetchApp.fetch(baseUrl + '/academic/assistantship-applications/inbox', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-marsys-forms-secret': secret },
    payload: JSON.stringify(payload),
    followRedirects: false,
    muteHttpExceptions: true,
  });
  const status = result.getResponseCode();
  if (status < 200 || status >= 300)
    throw new Error('MARSYS rechazó la entrega con estado HTTP ' + status + '.');
}
