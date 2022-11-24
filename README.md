# Node ESI

Node ESI is a wrapper for the common http library [Axios](https://github.com/axios/axios) reading the docs for Axios will give you an idea of how Node ESI works

### Install
```
npm i --save lachee/nodeesi
```

### Usage

```javascript
const Esi = require('node-esi');
Esi('alliances').then(console.log).catch(console.error);
```

### Cache

You can enable a redis cache by simply passing a redis uri to the cache function, afterwards all requests that can be cached locally will be

```javascript
Esi.cache('redis://127.0.0.1');
```

### Concurrency Manager

There is a concurrency manager loaded at start, you can detach the concurrency manager with

```javascript
// Detaches the concurrency manager
Esi.manager.detach();
```

You can also set a new concurrency manager by doing:

```javascript
// Set Concurrency to 5 requests at the same time
Esi.manager.detach();
Esi.manager = ConcurrencyManager(Esi, 5);
```

### SSO Auth

Use your own stuff

### Examples

```javascript
const Esi = require("node-esi");

(async () => {
    // Load a token as a string
    const token = await fetchTokenFromStorage();

    //Non Authed Request
    const alliances = await Esi('alliances');

    //Authed request
    const assets = await Esi(`characters/${token.character_id}/assets`, { token });
    
    //Versioning & Token as a function
    const fleet = await Esi(`characters/${token.character_id}/fleet`, { 
        version: 'dev',
        token: async () => {
            return await fetchTokenFromStorage()
        }
    });

    console.log("Request data", alliances.data)
    console.log("Request Time", alliances.requestTime)
})();
```
