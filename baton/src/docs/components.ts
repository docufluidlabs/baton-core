import { z } from 'zod';
import { registry } from './registry';

export const ErrorResponse = registry.register(
  'ErrorResponse',
  z.object({
    error: z.string().openapi({ example: 'Validation Error' }),
    message: z.string().openapi({ example: 'Request validation failed' }),
    statusCode: z.number().int().openapi({ example: 400 }),
    requestId: z.string().optional(),
    details: z
      .array(
        z.object({
          path: z.string(),
          message: z.string(),
        }),
      )
      .optional(),
  }),
);

type ErrorResponseDef = {
  description: string;
  content: { 'application/json': { schema: typeof ErrorResponse } };
};

const errorResp = (description: string): ErrorResponseDef => ({
  description,
  content: { 'application/json': { schema: ErrorResponse } },
});

export const commonErrorResponses = {
  400: errorResp('Validation error'),
  401: errorResp('Unauthorized — missing or invalid session token'),
  403: errorResp('Forbidden — insufficient role for this operation'),
  404: errorResp('Not found'),
  409: errorResp('Conflict'),
  429: errorResp('Rate limit exceeded'),
  500: errorResp('Internal server error'),
} as const;
