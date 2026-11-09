class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function validate(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, 'Invalid request');
  return result.data;
}

module.exports = { HttpError, validate };
