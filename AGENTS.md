---
name: NestJS and Project Guidelines
description: Reglas generales para agentes de IA trabajando en este proyecto NestJS
trigger: always_on
---

# Reglas del Proyecto (Backend - NestJS)

Todos los agentes de IA (incluyéndome) que trabajen en este proyecto deben adherirse estrictamente a las siguientes reglas y convenciones de código:

## 1. Arquitectura y Patrones (NestJS)
- **Modularidad:** Todo el código debe estar organizado en Módulos (`*.module.ts`).
- **Inyección de Dependencias:** Usar siempre Inyección de Dependencias (DI). No instanciar clases de servicio manualmente.
- **Responsabilidad Única:** 
  - Los **Controladores/Resolvers** solo deben manejar la capa HTTP/GraphQL (recibir peticiones, validar y devolver respuestas).
  - La lógica de negocio pesada debe residir en los **Servicios** (`*.service.ts`).

## 2. GraphQL (Code First)
- Usar el enfoque Code First con decoradores de `@nestjs/graphql` (`@ObjectType()`, `@InputType()`, `@Resolver()`, `@Query()`, `@Mutation()`).
- No modificar el archivo `schema.gql` a mano, dejar que NestJS lo autogenere.

## 3. Base de Datos (Prisma)
- Todo acceso a la base de datos debe hacerse a través de Prisma Client (`PrismaService`).
- No usar consultas SQL crudas (RAW SQL) a menos que sea estrictamente necesario por problemas de rendimiento o funcionalidades complejas no soportadas por Prisma.
- **MIGRACIONES OBLIGATORIAS:** Siempre que modifiques el archivo `schema.prisma`, debes ejecutar el comando correspondiente para crear y aplicar la respectiva migración, **asignándole un nombre descriptivo y acorde a los cambios realizados** (ejemplo: `npx prisma migrate dev --name agregar_tabla_usuarios`). NUNCA dejes un esquema modificado sin migrar ni uses nombres genéricos.

## 4. Estilo y Tipado
- Usar **TypeScript Estricto**. Evitar el uso de `any` o `@ts-ignore` siempre que sea posible. Define interfaces o clases para todo.
- Los nombres de variables, funciones y métodos deben ser en `camelCase`.
- Los nombres de Clases e Interfaces deben ser en `PascalCase`.
- Usar DTOs (Data Transfer Objects) con `class-validator` para validar la entrada de datos.

## 5. Respuestas y Errores
- Manejar los errores utilizando las excepciones integradas de NestJS (ej. `NotFoundException`, `BadRequestException`).
- Nunca exponer errores crudos de la base de datos al cliente.

## 6. Seguridad (Auth & RBAC)
- Proteger las rutas sensibles usando Guards (`@UseGuards()`).
- Extraer el usuario actual usando decoradores personalizados (ej. `@CurrentUser()`).

## 7. Flujo de Trabajo (Testing, Build y Commits)
- **Tests Unitarios Obligatorios:** Antes de finalizar cualquier nueva funcionalidad, DEBES crear sus respectivos tests unitarios (ej. `*.spec.ts`).
- **Verificación de Build:** Antes de hacer commit, DEBES comprobar que el proyecto compila correctamente ejecutando `npm run build`.
- **Commits Obligatorios:** Al terminar de implementar una funcionalidad, hacer los tests y comprobar el build, DEBES realizar el respectivo `git commit` y pushear los cambios. Nunca dejes trabajo terminado sin commitear.
