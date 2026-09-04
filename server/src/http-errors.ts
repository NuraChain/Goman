// The HTTP error vocabulary. Fastify reads `statusCode` off a thrown error and answers with
// it, so a handler expresses "the caller got this wrong" by throwing rather than by
// hand-assembling a reply - and a handler that throws anything else still becomes a 500 with
// the stack in the log and nothing leaked to the client.

export class HttpError extends Error {
    public readonly statusCode: number;

    constructor(statusCode: number, message: string) {
        super(message);
        this.name = new.target.name;
        this.statusCode = statusCode;
    }
}

/** 400 - the request is malformed or its content is refused. */
export class BadRequestError extends HttpError {
    constructor(message = 'Bad request') {
        super(400, message);
    }
}

/** 401 - no credential, or one that is no longer live. */
export class UnauthorizedError extends HttpError {
    constructor(message = 'Unauthorized') {
        super(401, message);
    }
}

/** 403 - a valid credential that is not allowed to do this. */
export class ForbiddenError extends HttpError {
    constructor(message = 'Forbidden') {
        super(403, message);
    }
}

/** 404 - no such thing. */
export class NotFoundError extends HttpError {
    constructor(message = 'Not found') {
        super(404, message);
    }
}

/** 429 - slow down; `retryAfter` is seconds and rides the Retry-After header. */
export class TooManyRequestsError extends HttpError {
    public readonly retryAfter: number;

    constructor(retryAfter: number, message = 'Too many requests') {
        super(429, message);
        this.retryAfter = retryAfter;
    }
}
