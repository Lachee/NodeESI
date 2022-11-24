const adapters = require("./adapter");

async function request(config) {
  config.requestStart = process.hrtime.bigint();
  if (!config.url.startsWith("/")) {
    config.url = "/" + config.url;
  }

  config.url = (config.version || "latest") + config.url;

  // Determine the token. If it is a string, then just use it. Otherwise, call the function and see if it is valid
  let token = null;
  if (typeof config.token === 'string' || config.token instanceof String) {
    token = config.token;
  } else if (config.token !== null) {
    token = await config.token();
  }

  if (token != null) { 
    config.headers = {
      Authorization: `Bearer ${token}`
    };
  }

  //If we have redis connection assume using cache adapter
  config.adapter = config.redis ? adapters.CacheAdapter : adapters.EsiAdapter;
  return config;
}

async function response(res) {
  res.requestTime = parseInt(process.hrtime.bigint() - res.config.requestStart);
  return res;
}

async function requestError(error) {
  return Promise.reject(error);
}

async function responseError(error) {
  if (!error.response) {
    return Promise.reject(error);
  } else {
    return Promise.reject({
      status: error.response.status,
      message: error.response.data.error,
      url: error.config.url,
      ratelimit: {
        remain: parseInt(error.response.headers["x-esi-error-limit-remain"]),
        reset: parseInt(error.response.headers["x-esi-error-limit-reset"])
      }
    });
  }
}

module.exports = {
  request,
  response,
  requestError,
  responseError
};
