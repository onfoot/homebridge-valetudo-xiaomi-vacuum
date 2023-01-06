const http = require('http');
const urllib = require('url');

async function sendJSONRequest(params) {
  return new Promise((resolve, reject) => {
    if (!params.url) {
      reject(Error('Request URL missing'));
    }

    const components = new urllib.URL(params.url);

    const options = {
      method: params.method || 'GET',
      raw_response: params.raw_response || false,
      host: components.hostname,
      port: components.port,
      path: components.pathname + (components.search ? components.search : ''),
      protocol: components.protocol,
      headers: { 'Content-Type': 'application/json' },
    };

    if (params.authentication) {
      const credentials = Buffer.from(params.authentication).toString('base64');
      options.headers.Authorization = `Basic ${credentials}`;
    }

    const req = http.request(options, (res) => {
      res.setEncoding('utf8');

      let chunks = '';
      res.on('data', (chunk) => { chunks += chunk; });
      res.on('end', () => {
        try {
          if (params.log) {
            params.log.debug(`Raw response: ${chunks}`);
          }

          if (options.raw_response) {
            resolve(chunks);
          } else {
            try {
              const parsed = JSON.parse(chunks);
              resolve(parsed);
            } catch (parseError) {
              reject(new Error(`${parseError}; content: '${chunks}'`));
            }
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', (err) => {
      reject(err);
    });

    if (params.content) {
      const stringified = JSON.stringify(params.content);
      req.write(stringified);
    }

    req.end();
  });
}

module.exports = { sendJSONRequest };
