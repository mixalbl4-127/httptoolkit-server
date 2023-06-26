import type {
    Application as ExpressApp,
    NextFunction
} from 'express';
import type {
    Request,
    Response,
    RequestHandler,
    RouteParameters
} from 'express-serve-static-core';
import type { ParsedQs } from 'qs';

import { ErrorLike, StatusError } from '../util/error';
import { ApiModel } from './api-model';

/**
 * This file exposes the API model via a REST-ish classic HTTP API.
 * All endpoints take & receive JSON only. Status codes are used
 * directly to indicate any errors, with any details returned
 * as JSON in an `error` field.
 */

export function exposeRestAPI(
    server: ExpressApp,
    apiModel: ApiModel
) {
    server.get('/version', handleErrors((_req, res) => {
        res.send({ version: apiModel.getVersion() });
    }));

    server.post('/update', handleErrors((_req, res) => {
        apiModel.updateServer();
        res.send({ success: true });
    }));

    server.post('/shutdown', handleErrors((_req, res) => {
        apiModel.shutdownServer();
        res.send({ success: true });
    }));

    server.get('/config', handleErrors(async (req, res) => {
        const proxyPort = getProxyPort(req.query.proxyPort);
        res.send({ config: await apiModel.getConfig(proxyPort) });
    }));

    server.get('/config/network-interfaces', handleErrors((_req, res) => {
        res.send({ networkInterfaces: apiModel.getNetworkInterfaces() });
    }));

    // Get top-line data on the current interceptor state
    server.get('/interceptors', handleErrors(async (req, res) => {
        const proxyPort = getProxyPort(req.query.proxyPort);
        res.send({ interceptors: await apiModel.getInterceptors(proxyPort) });
    }));

    // Get full detailed data on a specific interceptor state, i.e. detailed metadata.
    server.get('/interceptors/:id', handleErrors(async (req, res) => {
        const interceptorId = req.params.id;
        const proxyPort = getProxyPort(req.query.proxyPort);

        res.send({
            interceptors: await apiModel.getInterceptor(interceptorId, {
                proxyPort: proxyPort,
                metadataType: 'detailed'
            })
        });
    }));

    server.post('/interceptors/:id/activate/:proxyPort', handleErrors(async (req, res) => {
        const interceptorId = req.params.id;
        const proxyPort = parseInt(req.params.proxyPort, 10);
        if (isNaN(proxyPort)) throw new StatusError(400, `Could not parse required proxy port: ${req.params.proxyPort}`);

        const interceptorOptions = req.body || undefined;

        const result = await apiModel.activateInterceptor(interceptorId, proxyPort, interceptorOptions);
        res.send({ result });
    }));
}

function getProxyPort(stringishInput: any) {
    // Proxy port is optional everywhere, to make it possible to query data
    // in parallel (without waiting for Mockttp) for potentially faster setup.

    if (!stringishInput) return undefined;

    const proxyPort = parseInt(stringishInput as string, 10);
    if (isNaN(proxyPort)) return undefined;

    return proxyPort;
}

// A wrapper to automatically apply async error handling & responses to an Express handler. Fairly simple logic,
// very awkward (but not actually very interesting) types.
function handleErrors<
    Route extends string,
    P = RouteParameters<Route>,
    ResBody = any,
    ReqBody = any,
    ReqQuery = ParsedQs,
    Locals extends Record<string, any> = Record<string, any>,
>(
    handler: RequestHandler<P, ResBody, ReqBody, ReqQuery, Locals>
): RequestHandler<P, ResBody, ReqBody, ReqQuery, Locals> {
    return (async (req: Request<P, ResBody, ReqBody, ReqQuery, Locals>, res: Response<any, Locals>, next: NextFunction) => {
        try {
            return await handler(req, res, next);
        } catch (e) {
            const error = e as ErrorLike;

            console.log(`Error handling request to ${req.path}: ${error.message ?? error}`);
            reportError(error);

            // Use default error handler if response started (kills the connection)
            if (res.headersSent) return next(error)
            else {
                const status = (error.status && error.status >= 400 && error.status < 600)
                    ? error.status
                    : 500;

                res.status(status).send({
                    error: {
                        code: error.code,
                        message: error.message,
                        stack: error.stack
                    }
                })
            }
        }
    }) as any;
}