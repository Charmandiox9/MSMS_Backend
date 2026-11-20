# Postulaciones de ayudantía por Google Forms

El activador del formulario entrega cada respuesta a `POST /api/academic/assistantship-applications/inbox`. La bandeja aparece en **Ayudantías → Postulaciones de ayudantía** para quienes tienen permiso de gestión.

## Formulario

Usa un Google Form institucional con **Recopilar direcciones de correo electrónico → Verificado**. El correo recopilado se envía junto con estas ocho preguntas obligatorias:

| Pregunta | Tipo |
| --- | --- |
| Nombre | Respuesta corta |
| RUT | Respuesta corta, con dígito verificador |
| Teléfono | Respuesta corta, admite prefijo internacional |
| Carrera | Respuesta corta o lista de carreras |
| Dirección | Respuesta corta |
| Asignatura a la que postula como ayudante | Respuesta corta o lista de asignaturas |
| Motivación | Párrafo |
| PPA | Respuesta corta, con coma o punto decimal y hasta dos decimales |

Usa un formulario vacío y ejecuta `prepararFormularioVacio` para crear las preguntas, o configura los títulos de la tabla en el formulario existente. Confirma el modo **Verificado** en la interfaz de Forms. El script obtiene el correo desde la respuesta, sin agregar una pregunta de correo editable.

## Conexión

1. Aplica la migración `20261119190000_add_assistantship_applications` en el entorno de destino y configura un secreto propio de esta integración en `ASSISTANTSHIP_FORMS_WEBHOOK_SECRET`. El backend debe estar disponible por HTTPS.
2. Copia [google-forms.gs](google-forms.gs) en el proyecto abierto desde el formulario o en tu proyecto independiente de Apps Script.
3. En **Configuración del proyecto → Propiedades del script**, agrega `MARSYS_API_BASE_URL` con la URL HTTPS del backend incluyendo `/api`, y `ASSISTANTSHIP_FORMS_WEBHOOK_SECRET` con el mismo valor del backend. Si el proyecto es independiente, agrega también `MARSYS_ASSISTANTSHIP_FORM_ID` con el ID que figura entre `/d/` y `/edit` en el enlace de edición. Usa una cuenta con acceso de edición. [Documentación de FormApp](https://developers.google.com/apps-script/reference/forms/form-app#getactiveform)
4. Ejecuta `instalarTriggerPostulaciones` y autoriza el activador desde la cuenta propietaria o encargada. Envía una respuesta de prueba desde la vista de usuario y comprueba que aparece en la bandeja. El identificador de formulario y respuesta evita duplicados al reenviar.
5. Para recuperar una respuesta individual, agrega su ID de Google Forms a la propiedad `MARSYS_RETRY_RESPONSE_ID` y ejecuta `reenviarPostulacionPorId`. Consulta los errores de activación desde **Ejecuciones** en Apps Script.

La API busca una ficha por correo normalizado. Las respuestas sin coincidencia quedan disponibles para revisión y pueden vincularse cuando se registra la ayudantía. Aprobar conserva la postulación como registro pendiente de completar. En el registro formal se confirma la ficha y la asignación académica, y se cargan NRC, vigencia, tarifa, horas y horario según las reglas vigentes. La casilla de notificación se ofrece para ambas decisiones. El envío utiliza `RESEND_API_KEY` y `NOTIFICATIONS_FROM`, y el detalle muestra el resultado del intento.

Consulta la documentación de Google sobre [activadores instalables](https://developers.google.com/apps-script/guides/triggers/installable) y [respuestas de formularios](https://developers.google.com/apps-script/reference/forms/form-response).
