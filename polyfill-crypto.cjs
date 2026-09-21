const crypto = require('crypto');

if (crypto.webcrypto && crypto.webcrypto.getRandomValues) {
  const getRandomValues = crypto.webcrypto.getRandomValues.bind(crypto.webcrypto);
  crypto.getRandomValues = getRandomValues;
  if (!globalThis.crypto) {
    globalThis.crypto = crypto.webcrypto;
  }
  globalThis.crypto.getRandomValues = getRandomValues;
}

