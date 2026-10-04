# Correos de resolución de justificaciones

Las decisiones generan mensajes HTML con identidad MARSYS y una versión de
texto equivalente. El asunto identifica el resultado, la asignatura y su NRC.

El detalle incluye referencia de solicitud, correo del estudiante, asignatura,
código, NRC, paralelo, fecha de inasistencia con día de la semana, bloques
declarados y sus horas, y fecha de resolución en `America/Santiago`. Los campos
opcionales ausentes no se inventan. La fecha de inasistencia conserva su día
calendario, sin desplazamiento por zona horaria.

El estudiante recibe el resultado y las indicaciones para conservar la referencia
o consultar a Apoyo Docente. Si se rechaza, recibe también el motivo de rechazo.
Los docentes y ayudantes reciben solamente aprobaciones, con un saludo por nombre
y una explicación de por qué reciben el aviso. No se incluyen evidencias,
categorías de motivos ni observaciones privadas en los mensajes a docentes o
ayudantes. Los valores interpolados se escapan en HTML.

Los bloques mostrados provienen del formulario, no de una inferencia del horario
de clases. En aprobaciones sin bloques se explica que los avisos a ayudantes
consideran todas las ayudantías de esa asignatura durante ese día.

El formato no cambia las reglas de destinatarios ni el manejo de envíos fallidos.
Se utiliza la configuración existente `RESEND_API_KEY` y `NOTIFICATIONS_FROM`.
Las pruebas simulan el envío; no envían correos reales.
