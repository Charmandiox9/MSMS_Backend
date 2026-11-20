import { ValidateBy, type ValidationOptions } from 'class-validator';
import { isValidChileanRut } from './chilean-rut.util';

export function IsChileanRut(validationOptions?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isChileanRut',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && isValidChileanRut(value),
        defaultMessage: () => 'El RUT ingresado no es válido',
      },
    },
    validationOptions,
  );
}
