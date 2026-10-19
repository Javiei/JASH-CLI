/** Error "esperado" que se muestra al usuario sin stack trace. */
export class JashError extends Error {
  constructor(message, { code, hint } = {}) {
    super(message);
    this.name = 'JashError';
    this.code = code;
    this.hint = hint;
  }
}
