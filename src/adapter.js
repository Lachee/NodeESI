const instance = require("./index");
const crypto = require("crypto");
const axios = require("axios");
const sleep = require("util").promisify(setTimeout);

/** Adapter for regular requests */
async function EsiAdapter(request) {
    request.adapter = axios.default.adapter;
    return await makeRequest(request);
}

/** Adapter for Redis caching */
async function CacheAdapter(request) {
    const cache = new Cache(request);
    await cache.check();

    if (cache.exists) {
        cache.response.cached = true;
        cache.response.config = request;
        return cache.response;
    }

    request.adapter = axios.default.adapter;
    const response = await makeRequest(request);
    if (response.headers.expires) {
        cache.cacheResponse(response);
    }

    response.cached = false;
    return response;
}

/** Adapter for Redis that uses ETags */
async function ETagCacheAdapter(request) {
    const requestKey = createHashFromRequest(request);
    let etagObject = null;
    
    if (request.redis) {
        // Check if we have the resposne cached. If we do use that
        const rawCachedResponse = await request.redis.get(`${requestKey}:response`);
        if (rawCachedResponse) {
            const cachedResponse = JSON.parse(rawCachedResponse);
            cachedResponse.cached = true;
            cachedResponse.config = request;
            return cachedResponse;
        }

        // Load the etag
        const rawEtagResponse = await request.redis.get(`${requestKey}:etag`);
        if (rawEtagResponse) {
            etagObject = JSON.parse(rawEtagResponse);
        }
    }

    request.adapter = axios.default.adapter;
    if (etagObject != null)
        request.headers['If-None-Match'] = etagObject.etag;

    // Make the request. If we get 304 that means we should just reuse the etag object.
    const response = await makeRequest(request);
    if (response.status === 304) {
        response.data = etagObject.data;
        response.cached = 'etag';
        return response;
    }

    // If it exires, lets cache the response
    if (request.redis) {
        let expires = 600000;

        // Cache the response
        if (response.headers.expires) {
            expires = +new Date(response.headers.expires) - +new Date(response.headers.date);
            const responseData = JSON.stringify({
                url: response.url,
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
                data: response.data,
            });

            await request.redis.setex(`${requestKey}:response`, expires / 1000 + 1, responseData);
        }

        // Cache the etag object
        const etagData = JSON.stringify({
            etag: response.headers.etag,
            data: response.data
        });
        await request.redis.setex(`${requestKey}:etag`, (expires*10) / 1000 + 1, etagData);
    }

    response.cached = false;
    return response;
}

/** Makes a request */
async function makeRequest(request) {
    try {
        return await axios(request);
    } catch (ex) {
        /*
         * If no response throw the exception
         */

        if (!ex.response) throw ex;

        /*
         * If the error is a 502, then CCP's API isn't doing well
         * We combat this by retrying it up to 3 times
         */

        if ([502, 504].includes(ex.response.status)) {
            request.retries = request.retries ? request.retries + 1 : 1;
            if (request.retries > 3) throw ex;
            else return makeRequest(request);
        }

        /*
         * If the ratelimit is less than 10 remaining requests
         * sleep until the ratelimit is reset then throw the exception
         */

        if (ex.response.headers["x-esi-error-limit-remain"] < 10) {
            const reset = ex.response.headers["x-esi-error-limit-reset"];
            console.warn(`NodeESI: Ratelimit has been reached, sleeping for ${reset}s`);
            await sleep(reset * 1000);
            throw ex;
        }

        /*
         * finally throw the exception
         */

        throw ex;
    }
}

class Cache {
    constructor(request) {
        this.config = request;
        this.hash = createHashFromRequest(request);
    }

    async check() {
        this.cache = await this.config.redis.get(this.hash);
        this.exists = Boolean(this.cache);
        this.response = JSON.parse(this.cache);
    }

    async cacheResponse(response) {
        const expires = +new Date(response.headers.expires) - +new Date(response.headers.date);
        const data = JSON.stringify({
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            data: response.data,
            url: response.url,
        });

        return await this.config.redis.setex(this.hash, expires / 1000 + 1, data);
    }
}

/** Creates a hash string representing the given request */
function createHashFromRequest(request) {
    const data = JSON.stringify({
        method: request.method,
        url:    request.url,
        params: request.params,
        auth:   request.headers.Authorization
    });

    return crypto
        .createHash("sha1")
        .update(data)
        .digest("hex");
}

module.exports = {
    CacheAdapter,
    EsiAdapter,
    ETagCacheAdapter
};
