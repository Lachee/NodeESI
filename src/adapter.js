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

/** Makes ar equest */
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
    constructor(config) {
        this.config = config;
        this.hash = this.getHash(config);
    }

    async check() {
        this.cache = await this.config.redis.get(this.hash);
        this.exists = Boolean(this.cache);
        this.response = JSON.parse(this.cache);
    }

    getHash() {
        const data = JSON.stringify({
            url: this.config.url,
            params: this.config.params,
            method: this.config.method,
            auth: this.config.headers.Authorization
        });

        return crypto
            .createHash("sha1")
            .update(data)
            .digest("hex");
    }

    async cacheResponse(request) {
        const expires = +new Date(request.headers.expires) - +new Date(request.headers.date);
        const data = JSON.stringify({
            status: request.status,
            statusText: request.statusText,
            headers: request.headers,
            data: request.data,
            url: request.url
        });

        return await this.config.redis.setex(this.hash, expires / 1000 + 1, data);
    }
}

module.exports = {
    CacheAdapter,
    EsiAdapter
};
