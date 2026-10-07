import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError } from './errors'
import { readJson } from './body'
export function ok(data: unknown, meta?: unknown) {
  return NextResponse.json({ success: true, data, ...(meta ? { meta } : {}) })
}
/** 统一响应与安全错误映射，日志不包含原始异常或SQL。 */
export function apiHandler(callback: (request: Request) => Promise<Response> | Response) {
  return async (request: Request): Promise<Response> => {
    const requestId = randomUUID()
    let response: Response
    try {
      response = await callback(request)
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          const target = error.meta?.target
          const fields = Array.isArray(target)
            ? target.filter((item): item is string => typeof item === 'string')
            : []
          error = new ApiError(
            409,
            'CONFLICT',
            '字段值已存在',
            fields.map((path) => ({ path, message: '字段值已存在' })),
          )
        } else if (error.code === 'P2025') error = new ApiError(404, 'NOT_FOUND', '记录不存在')
      }
      const failure = error
      const known = failure instanceof ApiError
      const validation = failure instanceof z.ZodError
      if (!known && !validation) console.error({ code: 'INTERNAL_ERROR', requestId })
      response = NextResponse.json(
        {
          success: false,
          error: {
            code: known ? failure.code : validation ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR',
            message: known ? failure.message : validation ? '输入格式不正确' : '服务器内部错误',
            ...(known && failure.details !== undefined
              ? { details: failure.details }
              : validation
                ? {
                    details: failure.issues.map((issue) => ({
                      path: issue.path.join('.'),
                      message: issue.message,
                    })),
                  }
                : {}),
            requestId,
          },
        },
        {
          status: known ? failure.status : validation ? 400 : 500,
          headers: known ? failure.headers : undefined,
        },
      )
    }
    response.headers.set('Cache-Control', 'no-store')
    response.headers.set('X-Request-Id', requestId)
    return response
  }
}
export async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(await readJson(request))
}
