/** OpenAI-compatible error helpers shared by routes and middleware. */

const ERROR_TYPES = {
  400: 'invalid_request_error',
  401: 'invalid_request_error',
  403: 'invalid_request_error',
  404: 'invalid_request_error',
  408: 'api_error',
  429: 'rate_limit_error',
  500: 'api_error',
  501: 'api_error',
  502: 'api_error',
  503: 'api_error',
  504: 'api_error',
};

export function errorTypeFor(status) {
  if (ERROR_TYPES[status]) return ERROR_TYPES[status];
  return status >= 500 ? 'api_error' : 'invalid_request_error';
}

/** The single place an OpenAI-shaped error envelope is produced. */
export function sendError(
  res,
  { status = 500, message, type, param = null, code = null, extra = {} }
) {
  if (res.headersSent) {
    res.end();
    return;
  }

  res.status(status).json({
    error: {
      message,
      type: type ?? errorTypeFor(status),
      param,
      code,
      ...extra,
    },
  });
}
