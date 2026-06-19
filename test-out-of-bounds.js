const { handler } = require('./netlify/functions/fourshared.js');
async function run() {
  process.env.FOURSHARED_CONSUMER_KEY = 'e9cf71326ac5b6992d2c2e90055daafd';
  process.env.FOURSHARED_CONSUMER_SECRET = 'e006d2303c28a7ae714cc4c5583a7176be14b909';
  const res = await handler({
    httpMethod: 'GET',
    queryStringParameters: { action: 'stream', id: '8L83RRhsge' },
    headers: { range: 'bytes=3145728-' }
  });
  console.log('Status Code:', res.statusCode);
  console.log('Body:', res.body);
}
run();
